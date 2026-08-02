import { normalizeText } from '../core/html.js';

export const MESSAGE_STATUSES = Object.freeze({
  draft: 'Koncept',
  scheduled: 'Naplánováno',
  approval_required: 'Čeká na schválení',
  ready: 'Připraveno k odeslání',
  sending: 'Odesílá se',
  sent: 'Odesláno',
  partially_failed: 'Částečně selhalo',
  failed: 'Odeslání selhalo',
  cancelled: 'Zrušeno',
});

export const MESSAGE_TYPES = Object.freeze({
  homework: 'Domácí úkol',
  test: 'Test',
  replacement_test: 'Náhradní test',
  missing_work: 'Chybějící práce',
  consultation: 'Konzultace',
  general: 'Běžné sdělení',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const CLOSED_MESSAGE_STATUSES = new Set(['sent', 'cancelled']);

function lower(value) { return String(value || '').trim().toLocaleLowerCase('cs'); }
function required(value, label) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${label} je povinné.`);
  return normalized;
}
function safeIso(value, label) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} nemá platné datum.`);
  return date.toISOString();
}
function titleCase(value) {
  return String(value || '').split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toLocaleUpperCase('cs') + part.slice(1).toLocaleLowerCase('cs')).join(' ');
}
function compareName(a, b) { return String(a.displayName || a.title || '').localeCompare(String(b.displayName || b.title || ''), 'cs', { numeric: true }); }
function compareNewest(a, b) { return String(b.scheduledAt || b.createdAt || '').localeCompare(String(a.scheduledAt || a.createdAt || '')); }

export class CommunicationService {
  constructor(repositories, serverService = null) {
    this.repositories = repositories;
    this.serverService = serverService;
  }

  async audit(action, entityType, entityId, metadata = {}) {
    return this.repositories.auditEvents.create({ action, entityType, entityId, metadata, timestamp: new Date().toISOString() });
  }

  parseEmails(raw) {
    const tokens = String(raw || '').split(/[\s,;]+/).map((item) => lower(item)).filter(Boolean);
    const invalid = [];
    const seen = new Set();
    const valid = [];
    for (const email of tokens) {
      if (!EMAIL_PATTERN.test(email)) { invalid.push(email); continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      valid.push(email);
    }
    return { valid, invalid };
  }

  deriveStudentName(email) {
    return titleCase(String(email || '').split('@')[0]) || 'Student';
  }

  async listStudents({ groupInstanceId = '', status = 'active', query = '' } = {}) {
    const [students, groups] = await Promise.all([this.repositories.students.list(), this.repositories.groupInstances.list()]);
    const group = groupInstanceId ? groups.find((item) => item.id === groupInstanceId) : null;
    const identityId = group?.groupIdentityId || '';
    const needle = lower(query);
    return students
      .filter((item) => !status || item.status === status)
      .filter((item) => !identityId || item.groupIdentityId === identityId || item.groupIdentityIds?.includes(identityId))
      .filter((item) => !needle || [item.displayName, item.email].some((value) => lower(value).includes(needle)))
      .sort(compareName);
  }

  async importStudents({ groupInstanceId, rawEmails }) {
    const group = await this.repositories.groupInstances.get(String(groupInstanceId || ''));
    if (!group) throw new Error('Vyberte skupinu pro import studentů.');
    const parsed = this.parseEmails(rawEmails);
    if (!parsed.valid.length) throw new Error('Nebyla nalezena žádná platná e-mailová adresa.');
    const all = await this.repositories.students.list();
    const byEmail = new Map(all.map((item) => [item.normalizedEmail || lower(item.email), item]));
    const created = [];
    const updated = [];
    for (const email of parsed.valid) {
      const existing = byEmail.get(email);
      if (existing) {
        const identities = [...new Set([...(existing.groupIdentityIds || []), existing.groupIdentityId, group.groupIdentityId].filter(Boolean))];
        const item = await this.repositories.students.update(existing.id, { status: 'active', groupIdentityId: existing.groupIdentityId || group.groupIdentityId, groupIdentityIds: identities, email, normalizedEmail: email, source: existing.source || 'email_import' });
        updated.push(item);
      } else {
        const item = await this.repositories.students.create({ displayName: this.deriveStudentName(email), email, normalizedEmail: email, groupIdentityId: group.groupIdentityId, groupIdentityIds: [group.groupIdentityId], status: 'active', source: 'email_import', importedAt: new Date().toISOString(), notes: '' });
        created.push(item);
      }
    }
    await this.audit('students-imported', 'studentImport', group.id, { created: created.length, updated: updated.length, invalid: parsed.invalid.length });
    return { created, updated, invalid: parsed.invalid };
  }

  async updateStudent(id, input) {
    const current = await this.repositories.students.get(id);
    if (!current) throw new Error('Student nebyl nalezen.');
    const email = lower(input.email ?? current.email);
    if (!EMAIL_PATTERN.test(email)) throw new Error('E-mailová adresa není platná.');
    const duplicate = (await this.repositories.students.list()).find((item) => item.id !== id && (item.normalizedEmail || lower(item.email)) === email);
    if (duplicate) throw new Error('Tato e-mailová adresa již patří jinému studentovi.');
    const updated = await this.repositories.students.update(id, { displayName: required(input.displayName ?? current.displayName, 'Jméno studenta'), email, normalizedEmail: email, notes: normalizeText(input.notes ?? current.notes), status: input.status === 'archived' ? 'archived' : 'active' });
    await this.audit('student-updated', 'student', id, { status: updated.status });
    return updated;
  }

  async archiveStudent(id) {
    const updated = await this.repositories.students.update(id, { status: 'archived', archivedAt: new Date().toISOString() });
    await this.audit('student-archived', 'student', id);
    return updated;
  }

  async restoreStudent(id) {
    const updated = await this.repositories.students.update(id, { status: 'active', archivedAt: null });
    await this.audit('student-restored', 'student', id);
    return updated;
  }

  async listTemplates({ includeArchived = false } = {}) {
    return (await this.repositories.messageTemplates.list()).filter((item) => includeArchived || item.status !== 'archived').sort(compareName);
  }

  async createTemplate(input) {
    const created = await this.repositories.messageTemplates.create({ title: required(input.title, 'Název šablony'), type: MESSAGE_TYPES[input.type] ? input.type : 'general', subject: required(input.subject, 'Předmět zprávy'), body: required(input.body, 'Text zprávy'), signature: normalizeText(input.signature), status: 'active', variables: ['studentName', 'groupName', 'subjectName', 'date', 'taskName'] });
    await this.audit('message-template-created', 'messageTemplate', created.id, { type: created.type });
    return created;
  }

  async updateTemplate(id, input) {
    const current = await this.repositories.messageTemplates.get(id);
    if (!current) throw new Error('Šablona zprávy nebyla nalezena.');
    const updated = await this.repositories.messageTemplates.update(id, { title: required(input.title ?? current.title, 'Název šablony'), type: MESSAGE_TYPES[input.type] ? input.type : current.type, subject: required(input.subject ?? current.subject, 'Předmět zprávy'), body: required(input.body ?? current.body, 'Text zprávy'), signature: normalizeText(input.signature ?? current.signature), status: input.status === 'archived' ? 'archived' : 'active' });
    await this.audit('message-template-updated', 'messageTemplate', id);
    return updated;
  }

  async archiveTemplate(id) {
    const updated = await this.repositories.messageTemplates.update(id, { status: 'archived' });
    await this.audit('message-template-archived', 'messageTemplate', id);
    return updated;
  }

  async listMessages({ status = '', groupInstanceId = '', query = '' } = {}) {
    const [messages, groups] = await Promise.all([this.repositories.messages.list(), this.repositories.groupInstances.list()]);
    const groupMap = new Map(groups.map((item) => [item.id, item]));
    const needle = lower(query);
    return messages
      .filter((item) => !status || item.status === status)
      .filter((item) => !groupInstanceId || item.groupInstanceId === groupInstanceId)
      .map((item) => ({ ...item, group: groupMap.get(item.groupInstanceId) || null }))
      .filter((item) => !needle || [item.subject, item.body, item.group?.displayName, ...(item.recipients || []).map((recipient) => recipient.displayName)].some((value) => lower(value).includes(needle)))
      .sort(compareNewest);
  }

  async resolveRecipients({ groupInstanceId = '', studentIds = [] } = {}) {
    const selected = new Set((Array.isArray(studentIds) ? studentIds : [studentIds]).filter(Boolean));
    let students = await this.listStudents({ groupInstanceId, status: 'active' });
    if (selected.size) students = students.filter((item) => selected.has(item.id));
    if (!students.length) throw new Error('Zpráva nemá žádného příjemce.');
    return students.map((student) => ({ studentId: student.id, displayName: student.displayName, email: student.email }));
  }

  applyVariables(text, context = {}) {
    return String(text || '').replace(/\{\{(studentName|groupName|subjectName|date|taskName)\}\}/g, (_, key) => String(context[key] || ''));
  }

  async createMessage(input) {
    const status = MESSAGE_STATUSES[input.status] ? input.status : 'draft';
    const scheduledAt = ['scheduled', 'approval_required'].includes(status) ? safeIso(input.scheduledAt, 'Čas odeslání') : '';
    if (status === 'scheduled' && !scheduledAt) throw new Error('Naplánovaná zpráva musí mít datum a čas.');
    const sensitive = input.sensitive === true || input.sensitive === 'on';
    const requireApproval = sensitive || input.requireApproval === true || input.requireApproval === 'on';
    const recipients = await this.resolveRecipients({ groupInstanceId: input.groupInstanceId, studentIds: input.studentIds });
    const finalStatus = status === 'scheduled' && requireApproval ? 'approval_required' : status;
    const created = await this.repositories.messages.create({
      type: MESSAGE_TYPES[input.type] ? input.type : 'general',
      groupInstanceId: String(input.groupInstanceId || '') || null,
      templateId: String(input.templateId || '') || null,
      subject: required(input.subject, 'Předmět zprávy'),
      body: required(input.body, 'Text zprávy'),
      recipients,
      status: finalStatus,
      scheduledAt,
      sensitive,
      requireApproval,
      createdBy: 'local-user',
      preparedAt: null,
      sentAt: null,
      cancelledAt: null,
    });
    await this.audit('message-created', 'message', created.id, { status: created.status, recipientCount: recipients.length, sensitive });
    return created;
  }

  async updateMessage(id, input) {
    const current = await this.repositories.messages.get(id);
    if (!current) throw new Error('Zpráva nebyla nalezena.');
    if (current.status === 'sent') throw new Error('Odeslanou zprávu nelze změnit.');
    const status = MESSAGE_STATUSES[input.status] ? input.status : current.status;
    const scheduledAt = ['scheduled', 'approval_required'].includes(status) ? safeIso(input.scheduledAt ?? current.scheduledAt, 'Čas odeslání') : (input.scheduledAt ?? current.scheduledAt);
    const recipients = input.studentIds || input.groupInstanceId ? await this.resolveRecipients({ groupInstanceId: input.groupInstanceId ?? current.groupInstanceId, studentIds: input.studentIds }) : current.recipients;
    const sensitive = input.sensitive !== undefined ? (input.sensitive === true || input.sensitive === 'on') : current.sensitive;
    const requireApproval = sensitive || (input.requireApproval !== undefined ? (input.requireApproval === true || input.requireApproval === 'on') : current.requireApproval);
    const finalStatus = status === 'scheduled' && requireApproval ? 'approval_required' : status;
    const updated = await this.repositories.messages.update(id, { type: MESSAGE_TYPES[input.type] ? input.type : current.type, groupInstanceId: input.groupInstanceId !== undefined ? (String(input.groupInstanceId || '') || null) : current.groupInstanceId, templateId: input.templateId !== undefined ? (String(input.templateId || '') || null) : current.templateId, subject: input.subject !== undefined ? required(input.subject, 'Předmět zprávy') : current.subject, body: input.body !== undefined ? required(input.body, 'Text zprávy') : current.body, recipients, status: finalStatus, scheduledAt, sensitive, requireApproval });
    await this.audit('message-updated', 'message', id, { status: updated.status });
    return updated;
  }

  async approveMessage(id) {
    const current = await this.repositories.messages.get(id);
    if (!current) throw new Error('Zpráva nebyla nalezena.');
    if (current.status !== 'approval_required') throw new Error('Zpráva nečeká na schválení.');
    const status = current.scheduledAt && new Date(current.scheduledAt).getTime() > Date.now() ? 'scheduled' : 'ready';
    const updated = await this.repositories.messages.update(id, { status, approvedAt: new Date().toISOString(), requireApproval: false });
    await this.audit('message-approved', 'message', id, { status });
    return updated;
  }

  async cancelMessage(id) {
    const current = await this.repositories.messages.get(id);
    if (!current || CLOSED_MESSAGE_STATUSES.has(current.status)) throw new Error('Zprávu nelze zrušit.');
    const updated = await this.repositories.messages.update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    await this.audit('message-cancelled', 'message', id);
    return updated;
  }

  async markSent(id) {
    const current = await this.repositories.messages.get(id);
    if (!current) throw new Error('Zpráva nebyla nalezena.');
    const updated = await this.repositories.messages.update(id, { status: 'sent', sentAt: new Date().toISOString() });
    await this.audit('message-marked-sent', 'message', id, { recipientCount: current.recipients?.length || 0 });
    return updated;
  }

  async processDueLocal(now = new Date()) {
    const messages = await this.repositories.messages.list();
    const due = messages.filter((item) => item.status === 'scheduled' && item.scheduledAt && new Date(item.scheduledAt).getTime() <= now.getTime());
    const prepared = [];
    for (const item of due) prepared.push(await this.repositories.messages.update(item.id, { status: item.requireApproval ? 'approval_required' : 'ready', preparedAt: new Date().toISOString() }));
    if (prepared.length) await this.audit('messages-prepared-local', 'messageBatch', 'due', { count: prepared.length });
    return prepared;
  }

  async listAttachments() {
    return (await this.repositories.attachments.list()).sort(compareNewest);
  }

  async rememberServerAttachment(metadata, links = []) {
    const existing = (await this.repositories.attachments.list()).find((item) => item.serverId === metadata.id);
    const payload = { serverId: metadata.id, fileName: metadata.fileName, mimeType: metadata.mimeType, size: metadata.size, checksum: metadata.checksum, purpose: metadata.purpose || 'material', visibility: metadata.visibility || 'private', status: 'active', serverCreatedAt: metadata.createdAt };
    const record = existing ? await this.repositories.attachments.update(existing.id, payload) : await this.repositories.attachments.create(payload);
    for (const link of links) await this.repositories.attachmentLinks.create({ attachmentId: record.id, entityType: link.entityType, entityId: link.entityId, purpose: link.purpose || metadata.purpose || 'material' });
    await this.audit('server-attachment-linked', 'attachment', record.id, { serverId: metadata.id });
    return record;
  }

  async removeAttachmentLocal(id) {
    const links = (await this.repositories.attachmentLinks.list()).filter((item) => item.attachmentId === id);
    await Promise.all(links.map((item) => this.repositories.attachmentLinks.remove(item.id)));
    await this.repositories.attachments.remove(id);
    await this.audit('attachment-removed-local', 'attachment', id);
  }


  async applyServerDeliveryResult(result) {
    const message = result?.message;
    if (message?.id) {
      const current = await this.repositories.messages.get(message.id);
      if (current) await this.repositories.messages.update(message.id, {
        status: message.status, sentAt: message.sentAt || null, preparedAt: message.preparedAt || current.preparedAt,
        approvedAt: message.approvedAt || current.approvedAt, deliverySummary: message.deliverySummary || null,
      });
    }
    for (const delivery of result?.deliveries || []) {
      const existing = (await this.repositories.messageDeliveries.list()).find((item) => item.id === delivery.id);
      if (existing) await this.repositories.messageDeliveries.update(delivery.id, delivery);
      else await this.repositories.messageDeliveries.create(delivery);
    }
    await this.audit('message-delivery-synced', 'message', message?.id || 'unknown', { deliveries: result?.deliveries?.length || 0, status: message?.status || '' });
    return result;
  }


  async syncMessagesFromServer() {
    if (!this.serverService?.isAuthenticated) return [];
    const serverMessages = await this.serverService.listServerMessages();
    for (const message of serverMessages) {
      const current = await this.repositories.messages.get(message.id);
      if (!current) continue;
      await this.repositories.messages.update(message.id, {
        status: message.status, sentAt: message.sentAt || null, preparedAt: message.preparedAt || current.preparedAt,
        approvedAt: message.approvedAt || current.approvedAt, deliverySummary: message.deliverySummary || null,
      });
    }
    return serverMessages;
  }

  async syncDeliveriesFromServer(messageId = '') {
    if (!this.serverService?.isAuthenticated) return [];
    const deliveries = await this.serverService.listDeliveries(messageId);
    for (const delivery of deliveries) {
      const existing = await this.repositories.messageDeliveries.get(delivery.id);
      if (existing) await this.repositories.messageDeliveries.update(delivery.id, delivery);
      else await this.repositories.messageDeliveries.create(delivery);
    }
    return deliveries;
  }

  async listDeliveries({ messageId = '', status = '' } = {}) {
    return (await this.repositories.messageDeliveries.list())
      .filter((item) => !messageId || item.messageId === messageId)
      .filter((item) => !status || item.status === status)
      .sort(compareNewest);
  }

  async snapshot() {
    const [students, templates, messages, attachments] = await Promise.all([this.repositories.students.list(), this.repositories.messageTemplates.list(), this.repositories.messages.list(), this.repositories.attachments.list()]);
    return {
      activeStudents: students.filter((item) => item.status === 'active').length,
      archivedStudents: students.filter((item) => item.status === 'archived').length,
      templates: templates.filter((item) => item.status !== 'archived').length,
      drafts: messages.filter((item) => item.status === 'draft').length,
      scheduled: messages.filter((item) => ['scheduled', 'approval_required'].includes(item.status)).length,
      ready: messages.filter((item) => item.status === 'ready').length,
      attachments: attachments.length,
    };
  }
}
