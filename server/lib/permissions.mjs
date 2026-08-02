export const ROLES = Object.freeze(['owner', 'admin', 'teacher', 'substitute']);
export const RECORD_VISIBILITIES = Object.freeze(['private', 'shared', 'substitution']);

const permissions = Object.freeze({
  owner: new Set(['server:read', 'users:read', 'users:write', 'audit:read', 'resources:read', 'resources:write', 'sync:read', 'sync:write', 'attachments:read', 'attachments:write', 'communication:read', 'communication:write', 'privacy:read', 'privacy:write', 'mail:read', 'mail:send', 'substitution:read', 'substitution:write', 'substitution:update', 'operations:read', 'operations:write', 'operations:restore']),
  admin: new Set(['server:read', 'users:read', 'users:write', 'audit:read', 'resources:read', 'resources:write', 'sync:read', 'sync:write', 'attachments:read', 'attachments:write', 'communication:read', 'communication:write', 'privacy:read', 'privacy:write', 'mail:read', 'mail:send', 'substitution:read', 'substitution:write', 'substitution:update', 'operations:read', 'operations:write']),
  teacher: new Set(['server:read', 'resources:read', 'resources:write', 'sync:read', 'sync:write', 'attachments:read', 'attachments:write', 'communication:read', 'communication:write', 'privacy:read', 'privacy:write', 'mail:read', 'mail:send', 'substitution:read', 'substitution:write', 'substitution:update']),
  substitute: new Set(['server:read', 'resources:read', 'attachments:read', 'substitution:read', 'substitution:update']),
});

export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'teacher';
}

export function normalizeVisibility(value, fallback = 'private') {
  return RECORD_VISIBILITIES.includes(value) ? value : fallback;
}

export function can(user, permission) {
  return Boolean(user && permissions[user.role]?.has(permission));
}

export function requirePermission(user, permission) {
  if (!can(user, permission)) {
    const error = new Error('K této operaci nemáte oprávnění.');
    error.status = 403;
    throw error;
  }
}

export function canAccessRecord(user, record, { write = false } = {}) {
  if (!user || !record) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (record.ownerId === user.id) return user.role !== 'substitute' || !write;
  if (write) return false;
  return record.visibility === 'shared' || record.visibility === 'substitution';
}
