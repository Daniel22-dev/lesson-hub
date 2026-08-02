import { randomUUID } from 'node:crypto';

function uid(prefix) { return `${prefix}_${randomUUID()}`; }
function nowIso() { return new Date().toISOString(); }
function due(value, now = Date.now()) { return !value || new Date(value).getTime() <= now; }
function staleSending(message, config, now = Date.now()) {
  if (message.status !== 'sending' || !message.sendingStartedAt) return false;
  return new Date(message.sendingStartedAt).getTime() <= now - (config.mailSchedulerIntervalMs * 2);
}

export class MessageDispatcher {
  constructor({ store, config, mailAdapter, audit }) {
    this.store = store;
    this.config = config;
    this.mailAdapter = mailAdapter;
    this.audit = audit;
    this.running = false;
  }

  deliveryStore() { return this.store.resource('messageDeliveries'); }

  listDeliveries({ user, messageId = '' } = {}) {
    return Object.values(this.deliveryStore())
      .filter((item) => user?.role === 'owner' || user?.role === 'admin' || item.ownerId === user?.id)
      .filter((item) => !messageId || item.messageId === messageId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  ensureDeliveries(message) {
    const store = this.deliveryStore();
    const existing = new Map(Object.values(store).filter((item) => item.messageId === message.id).map((item) => [item.recipientEmail, item]));
    const activeEmails = new Set((message.recipients || []).map((recipient) => String(recipient.email || '').trim().toLowerCase()).filter(Boolean));
    for (const delivery of existing.values()) {
      if (!activeEmails.has(delivery.recipientEmail) && ['pending', 'retrying'].includes(delivery.status)) {
        delivery.status = 'cancelled';
        delivery.nextAttemptAt = null;
        delivery.updatedAt = nowIso();
      }
    }
    for (const recipient of message.recipients || []) {
      const email = String(recipient.email || '').trim().toLowerCase();
      if (!email) continue;
      const known = existing.get(email);
      if (known) {
        if (known.status === 'cancelled') {
          known.status = 'pending';
          known.updatedAt = nowIso();
        }
        continue;
      }
      const timestamp = nowIso();
      const record = {
        id: uid('delivery'), ownerId: message.ownerId, messageId: message.id,
        recipientEmail: email, recipientName: String(recipient.displayName || ''),
        status: 'pending', attemptCount: 0, nextAttemptAt: null, lastAttemptAt: null,
        sentAt: null, provider: null, providerMessageId: null,
        errorCode: null, errorMessage: null, createdAt: timestamp, updatedAt: timestamp,
      };
      store[record.id] = record;
    }
    return Object.values(store).filter((item) => item.messageId === message.id);
  }

  async dispatchMessage(message, { actorId = null, force = false } = {}) {
    if (!message) throw Object.assign(new Error('Zpráva nebyla nalezena.'), { status: 404, code: 'message_missing' });
    if (message.requireApproval || message.status === 'approval_required') throw Object.assign(new Error('Zpráva vyžaduje schválení.'), { status: 409, code: 'message_approval_required' });
    if (!['ready', 'failed', 'partially_failed', 'scheduled'].includes(message.status) && !(force && message.status === 'sending')) throw Object.assign(new Error('Zpráva není připravena k odeslání.'), { status: 409, code: 'message_not_ready' });
    if (message.status === 'scheduled' && !force && !due(message.scheduledAt)) throw Object.assign(new Error('Naplánovaný čas ještě nenastal.'), { status: 409, code: 'message_not_due' });
    if (!Array.isArray(message.recipients) || !message.recipients.length) throw Object.assign(new Error('Zpráva nemá příjemce.'), { status: 400, code: 'message_no_recipients' });

    const deliveries = this.ensureDeliveries(message);
    message.status = 'sending';
    message.sendingStartedAt = nowIso();
    message.updatedAt = message.sendingStartedAt;
    await this.store.save();

    for (const delivery of deliveries) {
      if (delivery.status === 'sent') continue;
      if (!force && delivery.nextAttemptAt && !due(delivery.nextAttemptAt)) continue;
      delivery.status = 'sending';
      delivery.attemptCount += 1;
      delivery.lastAttemptAt = nowIso();
      delivery.updatedAt = delivery.lastAttemptAt;
      try {
        const result = await this.mailAdapter.send({
          to: delivery.recipientEmail,
          subject: message.subject,
          text: message.body,
          messageId: `<${message.id}.${delivery.id}@lesson-hub.local>`,
        });
        delivery.status = 'sent';
        delivery.sentAt = nowIso();
        delivery.provider = result.provider || this.mailAdapter.mode;
        delivery.providerMessageId = result.providerMessageId || null;
        delivery.errorCode = null;
        delivery.errorMessage = null;
        delivery.nextAttemptAt = null;
      } catch (error) {
        const permanent = error.permanent === true || delivery.attemptCount >= this.config.mailMaxAttempts;
        delivery.status = permanent ? 'failed' : 'retrying';
        delivery.errorCode = error.code || 'delivery_failed';
        delivery.errorMessage = String(error.message || 'Odeslání selhalo.').slice(0, 500);
        delivery.nextAttemptAt = permanent ? null : new Date(Date.now() + this.config.mailRetryMinutes * 60_000).toISOString();
      }
      delivery.updatedAt = nowIso();
      await this.store.save();
    }

    const current = this.ensureDeliveries(message);
    const sent = current.filter((item) => item.status === 'sent').length;
    const pending = current.filter((item) => ['pending', 'sending', 'retrying'].includes(item.status)).length;
    const failed = current.filter((item) => item.status === 'failed').length;
    message.deliverySummary = { total: current.length, sent, pending, failed };
    message.sentAt = sent === current.length ? nowIso() : message.sentAt || null;
    message.status = sent === current.length ? 'sent' : sent > 0 ? 'partially_failed' : pending > 0 ? 'ready' : 'failed';
    message.sendingStartedAt = null;
    message.updatedAt = nowIso();
    this.audit({ actorId, action: 'message-dispatched', entityType: 'message', entityId: message.id, metadata: message.deliverySummary });
    await this.store.save();
    return { message, deliveries: current };
  }

  async processDue({ actorId = null } = {}) {
    if (this.running) return { prepared: [], dispatched: [], skipped: true };
    this.running = true;
    try {
      const prepared = [];
      const dispatched = [];
      const messages = Object.values(this.store.resource('messages'));
      for (const message of messages) {
        if (staleSending(message, this.config)) {
          message.status = 'ready';
          message.sendingStartedAt = null;
          message.updatedAt = nowIso();
        }
        if (message.status === 'scheduled' && message.scheduledAt && due(message.scheduledAt)) {
          message.status = message.requireApproval || message.sensitive ? 'approval_required' : 'ready';
          message.preparedAt = nowIso();
          message.updatedAt = message.preparedAt;
          prepared.push(message);
        }
        if (message.status === 'ready' || message.status === 'partially_failed' || message.status === 'failed') {
          const retryable = this.ensureDeliveries(message).some((item) => item.status !== 'sent' && (!item.nextAttemptAt || due(item.nextAttemptAt)));
          if (!retryable) continue;
          try { dispatched.push(await this.dispatchMessage(message, { actorId })); } catch (error) {
            if (!['mail_disabled', 'smtp_config_missing', 'mail_from_missing'].includes(error.code)) throw error;
          }
        }
      }
      if (prepared.length) await this.store.save();
      return { prepared, dispatched, skipped: false };
    } finally { this.running = false; }
  }
}
