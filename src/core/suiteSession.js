import { blockPersistence, isPersistenceBlocked } from './persistenceGuard.js';

export const SUITE_SESSION_CONTRACT = 'ghrab-suite-session-v1';
export const SUITE_SESSION_GENERATION_KEY = 'ghrab.platform.suite-session-generation.v1';
export const SUITE_SESSION_SEEN_KEY = 'ghrab.lesson-hub.suite-session-seen.v1';
export const SUITE_SESSION_PROGRESS_KEY = 'ghrab.lesson-hub.suite-session-progress.v1';
export const INDEXED_DB_NAMES_CLEAR_ON_END_WORK = Object.freeze(['lesson-hub-db']);

export const LOCAL_STORAGE_CLEAR_ON_END_WORK = Object.freeze({
  exact: Object.freeze([
    'lesson-hub-ui-settings',
    'lesson-hub-server-config-v1',
    'lesson-hub-server-session-v1',
    'ghrab.lesson-hub.ui-settings.v1',
    'ghrab.lesson-hub.server-session.v1',
    'ghrab.lesson-hub.migration.p2-storage-namespace-v1.backup',
  ]),
  prefixes: Object.freeze([
    'lesson-hub.lesson-draft.v1.',
    'ghrab.lesson-hub.lesson-draft.v1.',
    'sync:',
    'ghrab.lesson-hub.sync.',
    'lesson-hub-',
    'ghrab.lesson-hub.legacy.',
  ]),
});

export const SESSION_STORAGE_CLEAR_ON_END_WORK = Object.freeze({
  exact: Object.freeze([
    'lesson-hub-server-session-v1',
    'ghrab.lesson-hub.server-session.v1',
  ]),
  prefixes: Object.freeze([]),
});

const LIFECYCLE_KEYS_PRESERVE = new Set([
  SUITE_SESSION_GENERATION_KEY,
  SUITE_SESSION_SEEN_KEY,
  SUITE_SESSION_PROGRESS_KEY,
  'ghrab.lesson-hub.migration.p2-storage-namespace-v1.done',
]);

const runtimeCleanupHooks = new Set();
const activeCleanup = new Map();
const successfulCleanup = new Set();
let installed = false;
let initialGeneration = '';
let currentCleanupPromise = null;
let endedGeneration = '';
let removePlatformHandler = null;

function platformSession() {
  const session = globalThis.GHRAB_PLATFORM?.session;
  return session?.contract === SUITE_SESSION_CONTRACT ? session : null;
}

function safeStorage(kind) {
  try { return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage; }
  catch { return null; }
}

function readStorage(store, key) {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}

function listStorageKeys(store) {
  const keys = [];
  if (!store) return { keys, error: 'storage-unavailable' };
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key) keys.push(key);
    }
    return { keys, error: null };
  } catch (error) {
    return { keys, error: error?.message || 'enumeration-failed' };
  }
}

function keyMatches(key, rules) {
  if (LIFECYCLE_KEYS_PRESERVE.has(key)) return false;
  if (rules.exact.includes(key)) return true;
  return rules.prefixes.some((prefix) => key.startsWith(prefix));
}

function writeProgress(payload) {
  const store = safeStorage('local');
  if (!store) throw new Error('localStorage není dostupné pro suite-session acknowledgement evidence.');
  const value = JSON.stringify({
    schema: 'ghrab-suite-session-progress-v1',
    appId: 'lesson-hub',
    ...payload,
  });
  store.setItem(SUITE_SESSION_PROGRESS_KEY, value);
  if (store.getItem(SUITE_SESSION_PROGRESS_KEY) !== value) throw new Error('Suite-session progress nebyl ověřitelně zapsán.');
  return JSON.parse(value);
}

function clearStorage(store, rules, label) {
  const failures = [];
  const listed = listStorageKeys(store);
  if (listed.error) return { candidates: [], failures: [`${label}:enumeration:${listed.error}`] };
  const candidates = listed.keys.filter((key) => keyMatches(key, rules));
  for (const key of candidates) {
    try {
      store.removeItem(key);
      const verified = listStorageKeys(store);
      if (verified.error) failures.push(`${label}:${key}:verification:${verified.error}`);
      else if (verified.keys.includes(key)) failures.push(`${label}:${key}:still-present`);
    } catch (error) {
      failures.push(`${label}:${key}:${error?.message || 'remove-failed'}`);
    }
  }
  return { candidates, failures };
}

async function deleteIndexedDatabase(name) {
  if (!globalThis.indexedDB?.deleteDatabase) return { name, skipped: true, reason: 'indexeddb-unavailable' };
  return new Promise((resolve, reject) => {
    let settled = false;
    let blockedTimer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (blockedTimer) clearTimeout(blockedTimer);
      callback();
    };
    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => finish(() => resolve({ name, deleted: true }));
    request.onerror = () => finish(() => reject(request.error || new Error(`IndexedDB ${name} se nepodařilo smazat.`)));
    request.onblocked = () => {
      if (settled || blockedTimer) return;
      blockedTimer = setTimeout(() => finish(() => {
        const error = new Error(`Smazání IndexedDB ${name} zůstalo blokováno otevřeným spojením.`);
        error.code = 'suite_cleanup_indexeddb_blocked';
        reject(error);
      }), 2000);
    };
  });
}

function renderEndedGate(generation) {
  try {
    document.documentElement.dataset.ghrabAccess = 'ended';
    document.documentElement.dataset.ghrabSuiteSession = 'ended';
    document.body.style.visibility = 'visible';
    document.body.className = 'ghrab-access-gate-body';

    const main = document.createElement('main');
    main.className = 'ghrab-access-gate';
    main.setAttribute('role', 'alert');
    main.setAttribute('aria-live', 'assertive');

    const mark = document.createElement('div');
    mark.className = 'ghrab-access-gate-mark';
    mark.textContent = '\ud83d\udd12';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'ghrab-access-gate-eyebrow';
    eyebrow.textContent = 'AI STUDIO GHRAB';

    const heading = document.createElement('h1');
    heading.textContent = 'Spole\u010dn\u00e1 relace byla ukon\u010dena';

    const status = document.createElement('p');
    status.dataset.suiteStatus = '';
    status.textContent = 'Lesson Hub ukon\u010duje lok\u00e1ln\u00ed pr\u00e1ci a ov\u011b\u0159uje bezpe\u010dn\u00fd \u00faklid sv\u00fdch dat.';

    const reason = document.createElement('p');
    reason.className = 'ghrab-access-gate-reason';
    reason.textContent = 'Tato karta z\u016fst\u00e1v\u00e1 uzam\u010dena, aby nemohla obnovit star\u00fd obsah nebo autosave.';

    const actions = document.createElement('div');
    actions.className = 'ghrab-access-gate-actions';
    const button = document.createElement('button');
    button.className = 'ghrab-access-gate-primary';
    button.type = 'button';
    button.dataset.suiteReload = '';
    button.textContent = 'Na\u010d\u00edst novou relaci';
    button.addEventListener('click', () => location.reload());
    actions.append(button);

    main.append(mark, eyebrow, heading, status, reason, actions);
    document.body.replaceChildren(main);
    document.documentElement.dataset.ghrabSuiteGeneration = String(generation || 'ended');
  } catch {
    // Persistence is already blocked even if the static lock screen cannot be rendered.
  }
}


function updateEndedGateStatus(message) {
  try {
    const status = document.querySelector('[data-suite-status]');
    if (status) status.textContent = String(message || '');
  } catch {}
}

async function runRuntimeCleanup(detail) {
  const failures = [];
  for (const hook of [...runtimeCleanupHooks]) {
    try {
      const result = await hook(detail);
      if (result === false || result?.ok === false) failures.push(result?.reason || 'runtime-hook-reported-failure');
    } catch (error) {
      failures.push(error?.message || 'runtime-hook-failed');
    }
  }
  return failures;
}

async function performCleanup(detail) {
  const generation = String(detail?.generation || '');
  if (!generation) return { ok: false, reason: 'missing-generation' };
  if (successfulCleanup.has(generation)) return { ok: true, generation, repeated: true };
  if (activeCleanup.has(generation)) return activeCleanup.get(generation);

  const promise = (async () => {
    blockPersistence({ generation, reason: detail?.reason || 'suite-session-end' });
    endedGeneration = generation;
    renderEndedGate(generation);

    const failures = [];
    const seenAt = new Date().toISOString();
    try {
      writeProgress({ generation, status: 'signal-seen', seenAt, reason: String(detail?.reason || 'suite-session-end') });
    } catch (error) {
      failures.push(`progress-seen:${error?.message || 'write-failed'}`);
    }

    failures.push(...await runRuntimeCleanup(detail));

    const localResult = clearStorage(safeStorage('local'), LOCAL_STORAGE_CLEAR_ON_END_WORK, 'localStorage');
    const sessionResult = clearStorage(safeStorage('session'), SESSION_STORAGE_CLEAR_ON_END_WORK, 'sessionStorage');
    failures.push(...localResult.failures, ...sessionResult.failures);

    for (const name of INDEXED_DB_NAMES_CLEAR_ON_END_WORK) {
      try { await deleteIndexedDatabase(name); }
      catch (error) { failures.push(`indexedDB:${name}:${error?.message || 'delete-failed'}`); }
    }

    if (failures.length) {
      try {
        writeProgress({ generation, status: 'cleanup-failed', seenAt, failedAt: new Date().toISOString(), failures });
      } catch {}
      updateEndedGateStatus('Lokální úklid se nepodařilo ověřeně dokončit. Karta zůstává uzamčena a cleanup nebude potvrzen jako úspěšný.');
      return { ok: false, generation, failures };
    }

    const completedAt = new Date().toISOString();
    try {
      writeProgress({
        generation,
        status: 'cleanup-completed',
        seenAt,
        completedAt,
        cleared: {
          localStorage: localResult.candidates,
          sessionStorage: sessionResult.candidates,
          indexedDB: INDEXED_DB_NAMES_CLEAR_ON_END_WORK,
        },
      });
    } catch (error) {
      return { ok: false, generation, failures: [`progress-completed:${error?.message || 'write-failed'}`] };
    }

    successfulCleanup.add(generation);
    updateEndedGateStatus('Lokální pracovní data Lesson Hubu byla ověřeně uklizena. Tato stará karta zůstává bezpečně uzamčena.');
    return { ok: true, generation, completedAt };
  })().finally(() => activeCleanup.delete(generation));

  activeCleanup.set(generation, promise);
  currentCleanupPromise = promise;
  return promise;
}

async function handleOutOfBandSuiteEnd(detail, { acknowledgeIfPending = false } = {}) {
  const result = await performCleanup(detail);
  if (!result.ok || !acknowledgeIfPending) return result;
  const session = platformSession();
  if (!session) return result;
  const generation = String(detail?.generation || '');
  if (generation && session.seen?.() !== generation) {
    const acknowledged = session.acknowledge?.(generation) === true;
    if (!acknowledged) return { ok: false, generation, failures: ['platform-acknowledgement-write-failed'] };
  }
  return result;
}

function suiteDetail(generation, reason, extra = {}) {
  return Object.freeze({
    schema: SUITE_SESSION_CONTRACT,
    generation: String(generation || ''),
    reason,
    clearApplicationData: true,
    appId: 'lesson-hub',
    ...extra,
  });
}

function currentGeneration() {
  const session = platformSession();
  if (session) return String(session.generation?.() || '');
  return String(readStorage(safeStorage('local'), SUITE_SESSION_GENERATION_KEY) || '');
}

function installContextHardening() {
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key !== SUITE_SESSION_GENERATION_KEY || !event.newValue) return;
    const generation = String(event.newValue);
    if (generation === initialGeneration && !isPersistenceBlocked()) return;
    void handleOutOfBandSuiteEnd(suiteDetail(generation, 'cross-context-hardening'), { acknowledgeIfPending: false });
  });

  globalThis.addEventListener?.('pageshow', (event) => {
    const generation = currentGeneration();
    if (!generation) return;
    if (generation !== initialGeneration || endedGeneration === generation || event.persisted && isPersistenceBlocked()) {
      void handleOutOfBandSuiteEnd(suiteDetail(generation, 'history-restore-hardening', { persisted: event.persisted === true }), { acknowledgeIfPending: true });
    }
  });
}

export function registerSuiteRuntimeCleanup(handler) {
  if (typeof handler !== 'function') throw new TypeError('Suite runtime cleanup musí být funkce.');
  runtimeCleanupHooks.add(handler);
  if (endedGeneration) {
    void Promise.resolve().then(() => handler(suiteDetail(endedGeneration, 'late-runtime-registration'))).catch(() => {});
  }
  return () => runtimeCleanupHooks.delete(handler);
}

export async function installSuiteSessionLifecycle() {
  if (installed) {
    if (currentCleanupPromise) await currentCleanupPromise;
    return { installed: true, platform: Boolean(platformSession()), ended: Boolean(endedGeneration), generation: endedGeneration };
  }
  installed = true;
  initialGeneration = currentGeneration();
  installContextHardening();

  const session = platformSession();
  if (!session) return { installed: true, platform: false, ended: false };

  removePlatformHandler = session.onEnd((detail) => performCleanup(detail), { replay: true });
  await Promise.resolve();
  if (currentCleanupPromise) await currentCleanupPromise;
  return { installed: true, platform: true, ended: Boolean(endedGeneration), generation: endedGeneration };
}

export function suiteSessionState() {
  return Object.freeze({
    installed,
    initialGeneration,
    currentGeneration: currentGeneration(),
    endedGeneration,
    persistenceBlocked: isPersistenceBlocked(),
    platformSeen: String(platformSession()?.seen?.() || ''),
    progress: readStorage(safeStorage('local'), SUITE_SESSION_PROGRESS_KEY),
  });
}

export function uninstallSuiteSessionLifecycleForTest() {
  removePlatformHandler?.();
  removePlatformHandler = null;
}
