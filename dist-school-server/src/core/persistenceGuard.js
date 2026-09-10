let blockedGeneration = '';
let blockedReason = '';

export function blockPersistence({ generation = '', reason = 'suite-session-end' } = {}) {
  blockedGeneration = String(generation || blockedGeneration || 'ended');
  blockedReason = String(reason || 'suite-session-end');
  try {
    globalThis.__LESSON_HUB_PERSISTENCE_BLOCKED__ = Object.freeze({ generation: blockedGeneration, reason: blockedReason });
  } catch {
    // Runtime marker is best-effort only; the module-local state is authoritative.
  }
  return { generation: blockedGeneration, reason: blockedReason };
}

export function isPersistenceBlocked() {
  return Boolean(blockedGeneration);
}

export function persistenceBlockState() {
  return Object.freeze({ blocked: Boolean(blockedGeneration), generation: blockedGeneration, reason: blockedReason });
}

export function assertPersistenceAllowed(operation = 'zápis dat') {
  if (!isPersistenceBlocked()) return true;
  const error = new Error(`Lesson Hub odmítl ${operation}, protože společná relace byla ukončena.`);
  error.name = 'SuiteSessionEndedError';
  error.code = 'suite_session_ended';
  throw error;
}
