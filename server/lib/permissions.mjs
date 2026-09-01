export const ROLES = Object.freeze(['owner', 'admin', 'teacher', 'substitute']);
export const RECORD_VISIBILITIES = Object.freeze(['private', 'shared', 'substitution']);

const SHAREABLE_RESOURCES = new Set(['materials', 'materialLinks']);

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

export function isShareableResource(resource) {
  return SHAREABLE_RESOURCES.has(String(resource || ''));
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

export function canAccessRecord(user, record, { write = false, resource = '' } = {}) {
  if (!user || !record) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (record.ownerId === user.id) return user.role !== 'substitute' || !write;
  if (write) return false;
  // Persisted visibility is not an authorization capability on its own. Legacy
  // versions could store visibility='shared' on sensitive resource types, so the
  // read decision must always bind the stored value to the current resource policy.
  // Period-bound substitution records use the dedicated substitution API.
  const shareable = isShareableResource(resource);
  return shareable && (record.visibility === 'shared' || record.visibility === 'substitution');
}
