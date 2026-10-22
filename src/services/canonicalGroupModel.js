/* Lesson Hub stage 04: metadata-only, read-only link to AI Studio Moje skupiny. */
export const CONSUMER_ID = 'lesson-hub';
export const CANONICAL_GROUP_SCHEMA = 'ghrab-teaching-group-v1';
export const CANONICAL_LINK_SCHEMA = 'lesson-hub-canonical-link-v1';
const META_KEYS = new Set(['schema', 'groupId', 'revision', 'displayName', 'schoolYear', 'subject', 'grade', 'status', 'updatedAt']);
const ID_RE = /^grp_[a-z0-9-]{12,}$/i;
const YEAR_RE = /^(\d{4})\/(\d{2}|\d{4})$/;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function validText(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max && !/[<>\u0000-\u001f\u007f]/.test(value);
}
export function normalizeAcademicYear(value) {
  const match = String(value ?? '').trim().match(YEAR_RE);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100; // 2099/00 means 2099/2100.
  }
  if (end !== start + 1) return null;
  return `${start}/${end}`;
}
export function validateCanonicalMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CENTRAL_META_OBJECT_INVALID');
  if (Object.keys(value).some((key) => !META_KEYS.has(key))) fail('CENTRAL_META_FIELDS_INVALID');
  if (value.schema !== CANONICAL_GROUP_SCHEMA || !ID_RE.test(value.groupId ?? '') ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !validText(value.displayName, 120) || !normalizeAcademicYear(value.schoolYear) ||
      !['active', 'archived'].includes(value.status) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    fail('CENTRAL_META_INVALID');
  }
  for (const field of ['subject', 'grade']) {
    if (value[field] != null && value[field] !== '' && !validText(value[field], 120)) fail('CENTRAL_META_INVALID');
  }
  return {
    schema: CANONICAL_GROUP_SCHEMA,
    groupId: value.groupId,
    revision: value.revision,
    displayName: value.displayName.trim(),
    schoolYear: value.schoolYear,
    subject: value.subject || null,
    grade: value.grade || null,
    status: value.status,
    updatedAt: value.updatedAt,
  };
}
export function validateCanonicalMetadataList(value) {
  if (!Array.isArray(value) || value.length > 200) fail('CENTRAL_METADATA_LIST_INVALID');
  const seen = new Set();
  return value.map((entry) => {
    const meta = validateCanonicalMetadata(entry);
    if (seen.has(meta.groupId)) fail('CENTRAL_GROUP_DUPLICATE');
    seen.add(meta.groupId);
    return meta;
  });
}
export function readCanonicalMetadataOnly(service) {
  if (!service || service.schema !== 'ghrab-groups-service-v1' || service.contractVersion !== 1 ||
      typeof service.listGroupMetadata !== 'function') fail('CENTRAL_SERVICE_CONTRACT_UNSUPPORTED');
  // Deliberate data minimization: lesson-hub reads ONLY listGroupMetadata.
  return validateCanonicalMetadataList(service.listGroupMetadata(CONSUMER_ID, { status: 'all' }));
}

export function assertMatchingYear(localYear, metadata) {
  const local = normalizeAcademicYear(localYear?.label);
  const remote = normalizeAcademicYear(metadata.schoolYear);
  if (!local || local !== remote) fail('CENTRAL_YEAR_MISMATCH');
  return local;
}
export function assertUniqueCanonicalGroup(instances, canonicalGroupId, excludeId = null) {
  if (!Array.isArray(instances)) fail('CENTRAL_LOCAL_LIST_INVALID');
  if (instances.some((group) => group.id !== excludeId && group.canonicalGroupId === canonicalGroupId)) {
    fail('CENTRAL_LINK_ALREADY_USED');
  }
}
export function canonicalLinkFields(metadata, at = new Date().toISOString()) {
  const meta = validateCanonicalMetadata(metadata);
  if (!Number.isFinite(Date.parse(at))) fail('CENTRAL_TIME_INVALID');
  return {
    canonicalGroupId: meta.groupId,
    canonicalRevision: meta.revision,
    canonicalSync: {
      schema: CANONICAL_LINK_SCHEMA,
      consumerAppId: CONSUMER_ID,
      displayName: meta.displayName,
      schoolYear: meta.schoolYear,
      subject: meta.subject,
      grade: meta.grade,
      status: meta.status,
      sourceUpdatedAt: meta.updatedAt,
      lastSyncedAt: at,
    },
  };
}
/** Backups may bypass Repository.create/update, so validate restored group links too. */
export function assertCanonicalLinksConsistent(instances) {
  if (!Array.isArray(instances)) fail('CENTRAL_STORED_LIST_INVALID');
  const seen = new Set();
  for (const group of instances) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) fail('CENTRAL_STORED_GROUP_INVALID');
    const id = group.canonicalGroupId;
    if (id == null || id === '') {
      if (group.canonicalRevision != null || group.canonicalSync != null) fail('CENTRAL_STORED_ORPHANED_LINK');
      continue;
    }
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) {
      fail(seen.has(id) ? 'CENTRAL_STORED_DUPLICATE_LINK' : 'CENTRAL_STORED_LINK_INVALID');
    }
    seen.add(id);
    if (!Number.isSafeInteger(group.canonicalRevision) || group.canonicalRevision < 1 ||
        !group.canonicalSync || typeof group.canonicalSync !== 'object' ||
        Array.isArray(group.canonicalSync) ||
        group.canonicalSync.schema !== CANONICAL_LINK_SCHEMA ||
        group.canonicalSync.consumerAppId !== CONSUMER_ID ||
        !['active','archived'].includes(group.canonicalSync.status) ||
        !normalizeAcademicYear(group.canonicalSync.schoolYear)) {
      fail('CENTRAL_STORED_LINK_INVALID');
    }
  }
  return true;
}

export function localOnlyFields() {
  return { canonicalGroupId: null, canonicalRevision: null, canonicalSync: null };
}
export function planCanonicalLink({ group, year, subject = null, metadata, allGroups = [] }) {
  if (!group?.id || !group.schoolYearId || !year || year.id !== group.schoolYearId) fail('CENTRAL_LOCAL_GROUP_INVALID');
  const meta = validateCanonicalMetadata(metadata);
  assertMatchingYear(year, meta);
  assertUniqueCanonicalGroup(allGroups, meta.groupId, group.id);
  if (group.canonicalGroupId && group.canonicalGroupId !== meta.groupId) fail('CENTRAL_LINK_SWITCH_REQUIRES_UNLINK');
  if (!group.canonicalGroupId && meta.status !== 'active') fail('CENTRAL_ARCHIVED_CANNOT_LINK');
  const previous = group.canonicalSync || null;
  if (group.canonicalGroupId && Number.isSafeInteger(group.canonicalRevision) && meta.revision < group.canonicalRevision) {
    fail('CENTRAL_REVISION_ROLLBACK');
  }
  if (group.canonicalGroupId && group.canonicalRevision === meta.revision && previous &&
      (previous.displayName !== meta.displayName || previous.schoolYear !== meta.schoolYear ||
       (previous.subject || null) !== meta.subject || (previous.grade || null) !== meta.grade ||
       previous.status !== meta.status || previous.sourceUpdatedAt !== meta.updatedAt)) {
    fail('CENTRAL_SAME_REVISION_CONFLICT');
  }
  const isLinked = group.canonicalGroupId === meta.groupId;
  const differentName = group.displayName !== meta.displayName;
  const changed = !isLinked || group.canonicalRevision !== meta.revision ||
    previous?.status !== meta.status || previous?.displayName !== meta.displayName;
  return {
    mode: isLinked ? 'refresh' : 'link',
    changed,
    groupId: group.id,
    expectedUpdatedAt: group.updatedAt,
    // updatedAt has millisecond granularity; this also catches same-ms changes.
    expectedLocalSnapshot: JSON.stringify(group),
    metadata: meta,
    localDisplayName: group.displayName,
    localSchoolYear: year.label,
    warnings: [differentName ? 'Názvy skupin se liší. Místní název se nepřepíše.' : '',
      meta.subject && subject && ![subject.name, subject.shortName].some((label) =>
        String(label || '').toLocaleLowerCase('cs') === meta.subject.toLocaleLowerCase('cs')) ?
        'Předměty se liší. Místní předmět zůstane beze změny.' : '',
      meta.grade && group.grade && meta.grade !== group.grade ?
        'Ročníky se liší. Místní ročník zůstane beze změny.' : '',
      meta.status === 'archived' ? 'Centrální skupina je archivovaná. Historie Lesson Hubu zůstává dostupná.' : ''].filter(Boolean),
  };
}
export function planCanonicalCreate({ year, subject, metadata, allGroups = [], displayName }) {
  const meta = validateCanonicalMetadata(metadata);
  if (meta.status !== 'active') fail('CENTRAL_ARCHIVED_CANNOT_CREATE');
  if (!year?.id || year.status !== 'active' || !subject?.id || subject.status !== 'active') fail('CENTRAL_LOCAL_SELECTION_INVALID');
  assertMatchingYear(year, meta);
  assertUniqueCanonicalGroup(allGroups, meta.groupId);
  if (!validText(String(displayName ?? ''), 120)) fail('CENTRAL_LOCAL_NAME_INVALID');
  if (allGroups.some((g) => g.schoolYearId === year.id && g.subjectId === subject.id &&
    String(g.displayName || '').toLocaleLowerCase('cs') === displayName.trim().toLocaleLowerCase('cs'))) {
    fail('CENTRAL_LOCAL_NAME_DUPLICATE');
  }
  const warnings = [];
  if (meta.displayName !== displayName.trim()) warnings.push('Místní označení se liší od názvu v AI Studiu. Vazba bude uložena podle ID.');
  if (meta.subject && ![subject.name, subject.shortName].some((label) =>
      String(label || '').toLocaleLowerCase('cs') === meta.subject.toLocaleLowerCase('cs')))
    warnings.push('Místní a centrální předmět se liší. Vytvoří se pouze požadovaná místní skupina.');
  return { mode: 'create', metadata: meta, localSchoolYear: year.label, localSubject: subject.name,
    displayName: displayName.trim(), warnings };
}
