import { isShareableResource, normalizeVisibility } from './permissions.mjs';

const SENSITIVE_ATTACHMENT_PURPOSES = new Set(['student', 'solution']);

function normalizeResourceRecord(resource, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const current = normalizeVisibility(record.visibility, 'private');
  const next = isShareableResource(resource) ? current : 'private';
  if (record.visibility === next) return false;
  record.visibility = next;
  return true;
}

function normalizeAttachmentRecord(attachment) {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false;
  const purpose = String(attachment.purpose || 'material');
  const current = normalizeVisibility(attachment.visibility, 'private');
  // Sensitive attachments are always private. Legacy unscoped substitution
  // attachments are also private because they are not bound to a period/ACL.
  const next = SENSITIVE_ATTACHMENT_PURPOSES.has(purpose) || current === 'substitution'
    ? 'private'
    : current;
  if (attachment.visibility === next) return false;
  attachment.visibility = next;
  return true;
}

export function normalizeOpenedStore(store) {
  const result = {
    changed: 0,
    auditEntries: 0,
    resourceRecords: 0,
    changePayloads: 0,
    attachments: 0,
  };

  for (const entry of store.data.audit || []) {
    if (!entry?.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata)) continue;
    const next = { ...entry.metadata };
    let dirty = false;
    if (entry.entityType === 'attachment' && Object.prototype.hasOwnProperty.call(next, 'fileName')) {
      delete next.fileName;
      dirty = true;
    }
    // Raw e-mail and the previous unsalted truncated SHA-256 are both personal
    // identifiers in a small school address space. Correlation is intentionally
    // dropped instead of requiring another long-lived server secret.
    if (Object.prototype.hasOwnProperty.call(next, 'email')) {
      delete next.email;
      dirty = true;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'emailHash')) {
      delete next.emailHash;
      dirty = true;
    }
    if (dirty) {
      entry.metadata = next;
      result.auditEntries += 1;
      result.changed += 1;
    }
  }

  for (const [resource, records] of Object.entries(store.data.resources || {})) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    for (const record of Object.values(records)) {
      if (normalizeResourceRecord(resource, record)) {
        result.resourceRecords += 1;
        result.changed += 1;
      }
    }
  }

  // Sync history is owner-scoped, but normalizing its persisted payload prevents
  // a future replay/import path from reintroducing a legacy broad visibility flag.
  for (const change of store.data.changes || []) {
    if (change?.operation !== 'upsert' || !change?.payload || typeof change.payload !== 'object' || Array.isArray(change.payload)) continue;
    if (normalizeResourceRecord(change.resource, change.payload)) {
      result.changePayloads += 1;
      result.changed += 1;
    }
  }

  for (const attachment of Object.values(store.data.attachments || {})) {
    if (normalizeAttachmentRecord(attachment)) {
      result.attachments += 1;
      result.changed += 1;
    }
  }

  return result;
}
