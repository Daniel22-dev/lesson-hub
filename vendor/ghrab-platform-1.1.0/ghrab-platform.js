(function (global) {
  'use strict';

  const PLATFORM_VERSION = '1.1.0';
  const CONTRACT = 'ghrab-platform-v1';
  const HANDOFF_SCHEMA = 'ghrab-studio-handoff-v2';
  const LEGACY_HANDOFF_SCHEMA = 'ghrab-handoff-v1';
  const MATERIAL_SCHEMA = 'ghrab-material-v1';
  const ARTIFACT_SCHEMA = 'ghrab-artifact-envelope-v1';
  const HANDOFF_KEY = 'ghrab.platform.handoff.v2';
  const LEGACY_HANDOFF_KEY = 'ghrab.handoff.v1';
  const EVENT_KEY = 'ghrab.pilot.events.v2';
  try { global.performance?.mark?.('ghrab-platform:start'); } catch (_) {}
  const scriptElement = document.currentScript;
  const scriptUrl = scriptElement && scriptElement.src ? new URL(scriptElement.src, location.href) : new URL('./ghrab/ghrab-platform.js', location.href);
  const rootUrl = new URL('../', scriptUrl);
  const logoUrl = new URL('assets/brand/school-logo.png', rootUrl).href;

  function parseConfig() {
    const external = global.GHRAB_PLATFORM_CONFIG;
    if (external && typeof external === 'object') return Object.assign({}, external);
    const node = document.getElementById('ghrab-platform-config');
    if (!node) return {};
    try {
      const parsed = JSON.parse(node.textContent || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.error('[GHRAB platform] Invalid platform config.', error);
      return {};
    }
  }

  const config = Object.freeze(parseConfig());
  const appId = String(config.appId || document.documentElement.dataset.ghrabAppId || '').trim();
  const appVersion = String(config.appVersion || document.documentElement.dataset.ghrabAppVersion || '').trim();

  function parseVersion(value) {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let index = 0; index < 3; index += 1) {
      if (a[index] > b[index]) return 1;
      if (a[index] < b[index]) return -1;
    }
    return 0;
  }

  function satisfies(version, range) {
    if (!range || range === '*') return true;
    const current = parseVersion(version);
    if (!current) return false;
    const parts = String(range).split(/\s+/).filter(Boolean);
    return parts.every((part) => {
      const match = part.match(/^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/);
      if (!match) return false;
      const operator = match[1] || '=';
      const target = match[2];
      const cmp = compareVersions(version, target);
      if (cmp === null) return false;
      if (operator === '>=') return cmp >= 0;
      if (operator === '<=') return cmp <= 0;
      if (operator === '>') return cmp > 0;
      if (operator === '<') return cmp < 0;
      if (operator === '=') return cmp === 0;
      const parsedTarget = parseVersion(target);
      if (operator === '^') return cmp >= 0 && current[0] === parsedTarget[0];
      if (operator === '~') return cmp >= 0 && current[0] === parsedTarget[0] && current[1] === parsedTarget[1];
      return false;
    });
  }

  function compatibilityStatus() {
    const range = String(config.requiredPlatformRange || '>=1.0.0 <2.0.0');
    const ok = satisfies(PLATFORM_VERSION, range);
    return Object.freeze({ ok, platformVersion: PLATFORM_VERSION, requiredRange: range, contract: CONTRACT });
  }

  const compatibility = compatibilityStatus();
  document.documentElement.dataset.ghrabPlatform = PLATFORM_VERSION;
  document.documentElement.dataset.ghrabPlatformCompatibility = compatibility.ok ? 'compatible' : 'blocked';

  function storage(name) {
    try {
      return global[name] || null;
    } catch (_) {
      return null;
    }
  }

  function safeGet(store, key) {
    try {
      return store ? store.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSet(store, key, value) {
    try {
      if (!store) return false;
      store.setItem(key, value);
      return store.getItem(key) === String(value);
    } catch (_) {
      return false;
    }
  }

  function safeRemove(store, key) {
    try {
      if (store) store.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  const rawStorage = (() => {
    const proto = global.Storage && global.Storage.prototype;
    return Object.freeze({
      getItem: proto && proto.getItem,
      setItem: proto && proto.setItem,
      removeItem: proto && proto.removeItem,
      key: proto && proto.key,
    });
  })();

  function rawGet(store, key) {
    try {
      return store && rawStorage.getItem ? rawStorage.getItem.call(store, key) : null;
    } catch (_) {
      return null;
    }
  }

  function rawSet(store, key, value) {
    try {
      if (!store || !rawStorage.setItem) return false;
      rawStorage.setItem.call(store, key, String(value));
      return rawGet(store, key) === String(value);
    } catch (_) {
      return false;
    }
  }

  function rawRemove(store, key) {
    try {
      if (store && rawStorage.removeItem) rawStorage.removeItem.call(store, key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function rawKeys(store) {
    const keys = [];
    if (!store || !rawStorage.key) return keys;
    try {
      for (let index = 0; index < store.length; index += 1) {
        const key = rawStorage.key.call(store, index);
        if (key) keys.push(key);
      }
    } catch (_) {}
    return keys;
  }

  function namespace(targetAppId, storeName) {
    const prefix = `ghrab.${String(targetAppId || appId).trim()}.`;
    const store = storage(storeName || 'localStorage');
    return Object.freeze({
      prefix,
      key: (suffix) => `${prefix}${String(suffix || '').replace(/^\.+/, '')}`,
      get: (suffix) => safeGet(store, `${prefix}${String(suffix || '').replace(/^\.+/, '')}`),
      set: (suffix, value) => safeSet(store, `${prefix}${String(suffix || '').replace(/^\.+/, '')}`, value),
      remove: (suffix) => safeRemove(store, `${prefix}${String(suffix || '').replace(/^\.+/, '')}`),
    });
  }

  function normaliseStorageMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') return null;
    const store = mapping.store === 'session' ? 'sessionStorage' : 'localStorage';
    if (mapping.legacy && mapping.canonical) {
      return Object.freeze({ type: 'exact', store, legacy: String(mapping.legacy), canonical: String(mapping.canonical), keepLegacy: mapping.keepLegacy === true });
    }
    if (mapping.legacyPrefix && mapping.canonicalPrefix) {
      return Object.freeze({ type: 'prefix', store, legacy: String(mapping.legacyPrefix), canonical: String(mapping.canonicalPrefix), keepLegacy: mapping.keepLegacy === true });
    }
    return null;
  }

  const storageMappings = Object.freeze(
    ((config.storageMigration && config.storageMigration.mappings) || [])
      .map(normaliseStorageMapping)
      .filter(Boolean)
      .sort((left, right) => right.legacy.length - left.legacy.length),
  );

  function mappingFor(storeName, key) {
    const value = String(key || '');
    for (const mapping of storageMappings) {
      if (mapping.store !== storeName) continue;
      if (mapping.type === 'exact' && value === mapping.legacy) return mapping;
      if (mapping.type === 'prefix' && value.startsWith(mapping.legacy)) return mapping;
    }
    return null;
  }

  function canonicalStorageKey(storeName, key) {
    const value = String(key || '');
    const mapping = mappingFor(storeName, value);
    if (!mapping) return value;
    if (mapping.type === 'exact') return mapping.canonical;
    return `${mapping.canonical}${value.slice(mapping.legacy.length)}`;
  }

  function legacyStorageKey(storeName, key) {
    const value = String(key || '');
    for (const mapping of storageMappings) {
      if (mapping.store !== storeName) continue;
      if (mapping.type === 'exact' && value === mapping.canonical) return mapping.legacy;
      if (mapping.type === 'prefix' && value.startsWith(mapping.canonical)) return `${mapping.legacy}${value.slice(mapping.canonical.length)}`;
    }
    return value;
  }

  function storageNameForInstance(instance) {
    try {
      if (instance === global.localStorage) return 'localStorage';
      if (instance === global.sessionStorage) return 'sessionStorage';
    } catch (_) {}
    return '';
  }

  function installStorageAliases() {
    if (!global.Storage || !rawStorage.getItem || storageMappings.length === 0) return false;
    const proto = global.Storage.prototype;
    if (proto.__ghrabStorageAliasesInstalled === true) return true;
    Object.defineProperty(proto, '__ghrabStorageAliasesInstalled', { configurable: false, enumerable: false, value: true });
    proto.getItem = function (key) {
      const storeName = storageNameForInstance(this);
      const canonical = storeName ? canonicalStorageKey(storeName, key) : String(key);
      return rawStorage.getItem.call(this, canonical);
    };
    proto.setItem = function (key, value) {
      const storeName = storageNameForInstance(this);
      const canonical = storeName ? canonicalStorageKey(storeName, key) : String(key);
      return rawStorage.setItem.call(this, canonical, value);
    };
    proto.removeItem = function (key) {
      const storeName = storageNameForInstance(this);
      const canonical = storeName ? canonicalStorageKey(storeName, key) : String(key);
      return rawStorage.removeItem.call(this, canonical);
    };
    return true;
  }

  function migrateStorage() {
    const migration = config.storageMigration;
    if (!migration || !appId || storageMappings.length === 0) {
      return { status: 'not-applicable', moved: 0, skipped: 0, failures: [] };
    }
    const id = String(migration.id || 'p2');
    const local = storage('localStorage');
    const markerKey = `ghrab.${appId}.migration.${id}.done`;
    const backupKey = `ghrab.${appId}.migration.${id}.backup`;
    if (rawGet(local, markerKey)) {
      installStorageAliases();
      return { status: 'already-done', moved: 0, skipped: 0, failures: [], backupKey };
    }

    const journal = [];
    const failures = [];
    let moved = 0;
    let skipped = 0;
    for (const mapping of storageMappings) {
      const store = storage(mapping.store);
      const candidates = mapping.type === 'exact'
        ? [mapping.legacy]
        : rawKeys(store).filter((key) => key.startsWith(mapping.legacy));
      if (candidates.length === 0) skipped += 1;
      for (const legacy of candidates) {
        const canonical = mapping.type === 'exact'
          ? mapping.canonical
          : `${mapping.canonical}${legacy.slice(mapping.legacy.length)}`;
        if (legacy === canonical) continue;
        const value = rawGet(store, legacy);
        if (value === null) {
          skipped += 1;
          continue;
        }
        const existing = rawGet(store, canonical);
        const entry = {
          legacy,
          canonical,
          store: mapping.store === 'sessionStorage' ? 'session' : 'local',
          size: value.length,
          canonicalExisted: existing !== null,
        };
        if (migration.backup === 'full') entry.value = value;
        journal.push(entry);
        if (existing === null && !rawSet(store, canonical, value)) {
          failures.push({ legacy, canonical, reason: 'write-failed' });
          continue;
        }
        if (rawGet(store, canonical) !== (existing === null ? value : existing)) {
          failures.push({ legacy, canonical, reason: 'verification-failed' });
          continue;
        }
        if (!mapping.keepLegacy) rawRemove(store, legacy);
        moved += 1;
      }
    }

    rawSet(local, backupKey, JSON.stringify({
      schema: 'ghrab-storage-migration-backup-v1',
      appId,
      appVersion,
      migrationId: id,
      createdAt: new Date().toISOString(),
      entries: journal,
    }));
    if (failures.length === 0) {
      rawSet(local, markerKey, JSON.stringify({ completedAt: new Date().toISOString(), moved, skipped, backupKey }));
    }
    installStorageAliases();
    const status = failures.length ? 'partial' : 'completed';
    document.documentElement.dataset.ghrabStorageMigration = status;
    return { status, moved, skipped, failures, backupKey };
  }

  function rollbackStorageMigration(options) {
    const opts = options || {};
    const migration = config.storageMigration;
    const id = String((migration && migration.id) || 'p2');
    const local = storage('localStorage');
    const markerKey = `ghrab.${appId}.migration.${id}.done`;
    const backupKey = `ghrab.${appId}.migration.${id}.backup`;
    let backup;
    try { backup = JSON.parse(rawGet(local, backupKey) || 'null'); } catch (_) { backup = null; }
    if (!backup || backup.schema !== 'ghrab-storage-migration-backup-v1' || !Array.isArray(backup.entries)) {
      return { status: 'missing-backup', restored: 0, failures: [] };
    }
    let restored = 0;
    const failures = [];
    for (const entry of backup.entries) {
      const store = storage(entry.store === 'session' ? 'sessionStorage' : 'localStorage');
      const canonicalValue = rawGet(store, entry.canonical);
      const value = entry.value !== undefined ? entry.value : canonicalValue;
      if (value === null || value === undefined || !rawSet(store, entry.legacy, value)) {
        failures.push({ legacy: entry.legacy, reason: 'restore-failed' });
        continue;
      }
      if (opts.keepCanonical !== true && entry.canonicalExisted !== true) rawRemove(store, entry.canonical);
      restored += 1;
    }
    if (failures.length === 0) rawRemove(local, markerKey);
    return { status: failures.length ? 'partial' : 'restored', restored, failures, backupKey };
  }

  const storageMigration = migrateStorage();
  const storageAliases = Object.freeze({
    contract: 'ghrab-storage-namespace-v1',
    prefix: `ghrab.${appId}.`,
    mappings: storageMappings,
    canonicalKey: canonicalStorageKey,
    legacyKey: legacyStorageKey,
    rollback: rollbackStorageMigration,
  });

  function supportedThemes() {
    const values = Array.isArray(config.theme && config.theme.supported) ? config.theme.supported : ['light', 'dark', 'system'];
    const clean = values.map((item) => String(item)).filter((item) => ['light', 'dark', 'system'].includes(item));
    return clean.length ? Array.from(new Set(clean)) : ['light', 'dark'];
  }

  function systemTheme() {
    try {
      return global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function normaliseTheme(value) {
    const supported = supportedThemes();
    const requested = String(value || '').toLowerCase();
    if (supported.includes(requested)) return requested;
    const fallback = String((config.theme && config.theme.default) || supported[0] || 'dark');
    return supported.includes(fallback) ? fallback : supported[0];
  }

  function getThemeContext() {
    const root = document.documentElement;
    const preference = normaliseTheme(root.dataset.themePreference || root.dataset.theme || (config.theme && config.theme.default));
    const resolved = preference === 'system' ? systemTheme() : preference;
    return Object.freeze({ contract: 'ghrab-theme-v1', preference, resolved, supported: supportedThemes() });
  }

  function reflectThemeToLegacy(resolved) {
    if (!document.body) return;
    document.body.classList.toggle('dark', resolved === 'dark');
    document.body.classList.toggle('light', resolved === 'light');
  }

  function applyTheme(value, options) {
    const preference = normaliseTheme(value);
    const resolved = preference === 'system' ? systemTheme() : preference;
    const root = document.documentElement;
    root.dataset.themePreference = preference;
    root.dataset.theme = resolved;
    root.dataset.themeResolved = resolved;
    root.style.colorScheme = resolved;
    reflectThemeToLegacy(resolved);
    if (!options || options.persist !== false) {
      safeSet(storage('localStorage'), `ghrab.${appId || 'platform'}.theme.v1`, preference);
    }
    try {
      document.dispatchEvent(new CustomEvent('ghrab:theme-change', { detail: { contract: 'ghrab-theme-v1', preference, resolved } }));
    } catch (_) {}
    return getThemeContext();
  }

  function initialiseTheme() {
    const store = storage('localStorage');
    const stored = safeGet(store, `ghrab.${appId || 'platform'}.theme.v1`);
    const bodyDark = document.body && document.body.classList.contains('dark');
    const bodyLight = document.body && document.body.classList.contains('light');
    const initial = stored || document.documentElement.dataset.themePreference || (bodyDark ? 'dark' : bodyLight ? 'light' : document.documentElement.dataset.theme) || (config.theme && config.theme.default);
    applyTheme(initial, { persist: Boolean(stored) });
  }

  function syncLegacyThemeClasses() {
    if (!document.body) return;
    let syncing = false;
    const syncBody = () => {
      if (syncing) return;
      const classTheme = document.body.classList.contains('dark') ? 'dark' : document.body.classList.contains('light') ? 'light' : null;
      if (classTheme && document.documentElement.dataset.theme !== classTheme) {
        syncing = true;
        applyTheme(classTheme);
        syncing = false;
      }
    };
    const syncRoot = () => {
      if (syncing) return;
      const root = document.documentElement;
      const declared = String(root.dataset.themePreference || root.dataset.theme || '').toLowerCase();
      if (!declared || !['light', 'dark', 'system'].includes(declared)) return;
      const current = getThemeContext();
      if (declared === current.preference || (declared === current.resolved && !root.dataset.themePreference)) return;
      syncing = true;
      applyTheme(declared);
      syncing = false;
    };
    new MutationObserver(syncBody).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(syncRoot).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-preference'] });
    try {
      const media = global.matchMedia && global.matchMedia('(prefers-color-scheme: light)');
      media && media.addEventListener('change', () => {
        if (document.documentElement.dataset.themePreference === 'system') applyTheme('system', { persist: false });
      });
    } catch (_) {}
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  }

  function readJson(key, storeName) {
    const raw = safeGet(storage(storeName || 'localStorage'), key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function validMaterial(material) {
    return Boolean(
      material &&
      typeof material === 'object' &&
      material.schema === MATERIAL_SCHEMA &&
      typeof material.id === 'string' &&
      material.id.length > 0 &&
      material.id.length <= 160 &&
      ((material.content && typeof material.content === 'object') || material.payload !== undefined)
    );
  }

  function fnv1a(value) {
    const bytes = new TextEncoder().encode(String(value));
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function handoffPayloadForChecksum(packet) {
    return stableStringify({
      schema: packet.schema,
      schemaVersion: packet.schemaVersion,
      id: packet.id,
      source: packet.source,
      target: packet.target,
      createdAt: packet.createdAt,
      expiresAt: packet.expiresAt,
      payload: packet.payload,
    });
  }

  function normaliseLegacyHandoff(payload) {
    if (!payload || payload.schema !== LEGACY_HANDOFF_SCHEMA || !validMaterial(payload.material)) return null;
    return {
      schema: HANDOFF_SCHEMA,
      schemaVersion: 2,
      id: `legacy-${fnv1a(JSON.stringify(payload))}`,
      source: { appId: String(payload.sourceAppId || payload.source || 'ai-studio'), appVersion: String(payload.sourceAppVersion || 'legacy') },
      target: { appId: String(payload.target || payload.targetAppId || ''), versionRange: String(payload.targetVersionRange || '*') },
      createdAt: payload.createdAt || new Date().toISOString(),
      expiresAt: payload.expiresAt,
      payload: { type: MATERIAL_SCHEMA, value: payload.material },
      byteLength: utf8Bytes(JSON.stringify(payload)),
      checksum: { algorithm: 'FNV-1A-32', value: fnv1a(JSON.stringify(payload.material)) },
      legacy: true,
      studioUrl: payload.studioUrl || '',
    };
  }

  function validateHandoff(payload, options) {
    const opts = options || {};
    const targetAppId = String(opts.target || appId || '');
    const maxBytes = Number(opts.maxBytes || config.bridgeMaxBytes || 500000);
    if (!payload || typeof payload !== 'object') return { ok: false, code: 'missing-payload' };
    const packet = payload.schema === LEGACY_HANDOFF_SCHEMA ? normaliseLegacyHandoff(payload) : payload;
    if (!packet || packet.schema !== HANDOFF_SCHEMA || packet.schemaVersion !== 2) return { ok: false, code: 'schema' };
    const actualBytes = utf8Bytes(JSON.stringify(packet));
    if (actualBytes > maxBytes || Number(packet.byteLength || 0) > maxBytes) return { ok: false, code: 'too-large' };
    const acceptedTargets = new Set([targetAppId].concat(Array.isArray(opts.aliases) ? opts.aliases : []).filter(Boolean));
    if (opts.allowAnyTarget !== true && !acceptedTargets.has(String(packet.target && packet.target.appId || ''))) return { ok: false, code: 'target' };
    const expires = Date.parse(packet.expiresAt || '');
    if (!Number.isFinite(expires) || expires <= Date.now()) return { ok: false, code: 'expired' };
    if (expires - Date.now() > 24 * 60 * 60 * 1000) return { ok: false, code: 'expiry-window' };
    if (!packet.source || !packet.source.appId || !packet.source.appVersion) return { ok: false, code: 'source' };
    if (!packet.payload || packet.payload.type !== MATERIAL_SCHEMA || !validMaterial(packet.payload.value)) return { ok: false, code: 'material' };
    const range = String(packet.target.versionRange || '*');
    if (appVersion && range !== '*' && !satisfies(appVersion, range)) return { ok: false, code: 'version-range' };
    if (!packet.legacy) {
      if (!packet.checksum || packet.checksum.algorithm !== 'FNV-1A-32') return { ok: false, code: 'checksum-format' };
      if (fnv1a(handoffPayloadForChecksum(packet)) !== packet.checksum.value) return { ok: false, code: 'checksum' };
    }
    return { ok: true, code: 'ok', packet, payload: {
      schema: HANDOFF_SCHEMA,
      sourceAppId: String(packet.source.appId),
      sourceAppVersion: String(packet.source.appVersion),
      target: String(packet.target.appId),
      targetVersionRange: range,
      createdAt: packet.createdAt,
      expiresAt: packet.expiresAt,
      studioUrl: packet.studioUrl || '',
      material: packet.payload.value,
      packet,
    } };
  }

  function recordBridgeEvent(type, materialId, details) {
    const events = readJson(EVENT_KEY) || [];
    const row = Object.assign({ at: new Date().toISOString(), type, appId, appVersion, materialId: String(materialId || '').slice(0, 160) }, details || {});
    const next = (Array.isArray(events) ? events : []).concat(row).slice(-500);
    safeSet(storage('localStorage'), EVENT_KEY, JSON.stringify(next));
    return row;
  }

  function peekHandoff(options) {
    const current = readJson(HANDOFF_KEY);
    const legacy = current ? null : readJson(LEGACY_HANDOFF_KEY);
    const source = current || legacy;
    const result = validateHandoff(source, options);
    if (!result.ok) {
      if (current) safeRemove(storage('localStorage'), HANDOFF_KEY);
      if (legacy) safeRemove(storage('localStorage'), LEGACY_HANDOFF_KEY);
      return null;
    }
    return result.payload;
  }

  function takeHandoff(options) {
    const payload = peekHandoff(options);
    if (!payload) return null;
    safeRemove(storage('localStorage'), HANDOFF_KEY);
    safeRemove(storage('localStorage'), LEGACY_HANDOFF_KEY);
    recordBridgeEvent('handoff-consumed', payload.material.id, { sourceAppId: payload.sourceAppId, contractVersion: 2 });
    return payload;
  }

  function createHandoff(options) {
    const opts = options || {};
    if (!validMaterial(opts.material)) throw new Error('Invalid GHRAB Material v1');
    const ttlMs = Math.min(Math.max(Number(opts.ttlMs || 30 * 60 * 1000), 60000), 24 * 60 * 60 * 1000);
    const packet = {
      schema: HANDOFF_SCHEMA,
      schemaVersion: 2,
      id: typeof global.crypto?.randomUUID === 'function' ? global.crypto.randomUUID() : `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      source: { appId: String(opts.sourceAppId || appId || ''), appVersion: String(opts.sourceAppVersion || appVersion || '') },
      target: { appId: String(opts.target || opts.targetAppId || ''), versionRange: String(opts.targetVersionRange || '*') },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      payload: { type: MATERIAL_SCHEMA, value: opts.material },
      byteLength: 0,
      checksum: { algorithm: 'FNV-1A-32', value: '' },
      studioUrl: String(opts.studioUrl || ''),
    };
    packet.byteLength = utf8Bytes(JSON.stringify(packet));
    packet.checksum.value = fnv1a(handoffPayloadForChecksum(packet));
    packet.byteLength = utf8Bytes(JSON.stringify(packet));
    const result = validateHandoff(packet, { target: packet.target.appId, maxBytes: opts.maxBytes || 500000 });
    if (!result.ok) throw new Error(`Invalid GHRAB handoff: ${result.code}`);
    if (!safeSet(storage('localStorage'), HANDOFF_KEY, JSON.stringify(packet))) throw new Error('Unable to store GHRAB handoff.');
    if (opts.writeLegacy !== false && config.bridgeWriteLegacy !== false) {
      const legacy = {
        schema: LEGACY_HANDOFF_SCHEMA,
        target: packet.target.appId,
        targetVersionRange: packet.target.versionRange,
        source: packet.source.appId,
        sourceAppId: packet.source.appId,
        sourceAppVersion: packet.source.appVersion,
        createdAt: packet.createdAt,
        expiresAt: packet.expiresAt,
        studioUrl: packet.studioUrl,
        material: packet.payload.value,
      };
      safeSet(storage('localStorage'), LEGACY_HANDOFF_KEY, JSON.stringify(legacy));
    }
    recordBridgeEvent('handoff-created', opts.material.id, { targetAppId: packet.target.appId, contractVersion: 2 });
    return result.payload;
  }

  function unlockProtectedScripts(options) {
    const opts = options || {};
    const root = opts.root || document;
    const selector = opts.selector || 'script[data-ghrab-protected]';
    const nodes = Array.from(root.querySelectorAll(selector));
    let count = 0;
    for (const source of nodes) {
      const executable = document.createElement('script');
      for (const attribute of Array.from(source.attributes)) {
        if (['type', 'data-ghrab-protected', 'data-ghrab-original-type'].includes(attribute.name)) continue;
        executable.setAttribute(attribute.name, attribute.value);
      }
      const originalType = source.getAttribute('data-ghrab-original-type');
      if (originalType) executable.type = originalType;
      else if (source.type && source.type !== 'application/ghrab-protected') executable.type = source.type;
      if (source.src && !source.hasAttribute('async') && executable.type !== 'module') executable.async = false;
      executable.textContent = source.textContent || '';
      source.replaceWith(executable);
      count += 1;
    }
    return count;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const result = {};
      for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
      return result;
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
    if (!global.crypto || !global.crypto.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function createArtifactEnvelope(options) {
    const opts = options || {};
    const envelope = {
      schema: ARTIFACT_SCHEMA,
      schemaVersion: 1,
      artifactType: String(opts.artifactType || 'data-export'),
      appId: String(opts.appId || appId || ''),
      appVersion: String(opts.appVersion || appVersion || ''),
      createdAt: opts.createdAt || new Date().toISOString(),
      sensitivity: String(opts.sensitivity || 'internal'),
      contentManifest: Array.isArray(opts.contentManifest) ? opts.contentManifest : [],
      payload: opts.payload === undefined ? null : opts.payload,
    };
    const checksumValue = await sha256(envelope);
    envelope.checksum = { algorithm: 'SHA-256', value: checksumValue };
    return envelope;
  }

  async function validateArtifactEnvelope(envelope, options) {
    const opts = options || {};
    const errors = [];
    if (!envelope || typeof envelope !== 'object') return { ok: false, errors: ['missing-envelope'] };
    if (envelope.schema !== ARTIFACT_SCHEMA || envelope.schemaVersion !== 1) errors.push('schema');
    if (!envelope.appId || !envelope.appVersion || !envelope.createdAt) errors.push('identity');
    if (!envelope.checksum || envelope.checksum.algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/i.test(envelope.checksum.value || '')) errors.push('checksum-format');
    if (opts.expectedAppId && envelope.appId !== opts.expectedAppId) errors.push('appId');
    if (opts.appVersionRange && !satisfies(envelope.appVersion, opts.appVersionRange)) errors.push('appVersion');
    if (errors.length === 0 && opts.verifyChecksum !== false) {
      const clone = Object.assign({}, envelope);
      delete clone.checksum;
      const actual = await sha256(clone);
      if (actual !== envelope.checksum.value) errors.push('checksum');
    }
    return { ok: errors.length === 0, errors };
  }

  function parseArtifactEnvelope(text) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    return parsed;
  }

  function isArtifactEnvelope(value) {
    return Boolean(value && typeof value === 'object' && value.schema === ARTIFACT_SCHEMA && value.schemaVersion === 1);
  }

  async function unwrapMaybeArtifact(value, options) {
    const opts = options || {};
    const parsed = parseArtifactEnvelope(value);
    if (!isArtifactEnvelope(parsed)) {
      if (opts.allowLegacy === false) throw new Error('Soubor nepoužívá jednotný formát GHRAB artefaktu.');
      return { payload: parsed, envelope: null, legacy: true };
    }
    const payload = await unwrapArtifact(parsed, opts);
    return { payload, envelope: parsed, legacy: false };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = String(filename || 'ghrab-artifact.json');
    link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadArtifact(options) {
    const opts = options || {};
    const envelope = opts.envelope || await createArtifactEnvelope(opts);
    const validation = await validateArtifactEnvelope(envelope, { verifyChecksum: true });
    if (!validation.ok) throw new Error(`Invalid GHRAB artifact envelope: ${validation.errors.join(', ')}`);
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), opts.filename || `${appId || 'ghrab'}-${envelope.artifactType}.ghrab.json`);
    return envelope;
  }

  async function unwrapArtifact(value, options) {
    const envelope = parseArtifactEnvelope(value);
    const validation = await validateArtifactEnvelope(envelope, options);
    if (!validation.ok) throw new Error(`Invalid GHRAB artifact envelope: ${validation.errors.join(', ')}`);
    return envelope.payload;
  }

  function createFooterBranding() {
    const brand = document.createElement('div');
    brand.className = 'ghrab-platform-footer__brand';
    const image = document.createElement('img');
    image.src = logoUrl;
    image.alt = '';
    image.width = 44;
    image.height = 44;
    const copy = document.createElement('div');
    const owner = document.createElement('strong');
    owner.textContent = 'Autor a vývojový garant: Daniel Baláž';
    const school = document.createElement('span');
    school.textContent = 'Gymnázium, Ostrava-Hrabůvka · Součást AI Studia GHRAB';
    copy.append(owner, school);
    brand.append(image, copy);

    const meta = document.createElement('div');
    meta.className = 'ghrab-platform-footer__meta';
    const project = document.createElement('span');
    project.textContent = `Školní projekt · © ${new Date().getFullYear()}`;
    const versionNode = document.createElement('span');
    versionNode.textContent = `${config.appName || appId || 'GHRAB'} · v${appVersion || '?'}`;
    meta.append(project, versionNode);
    return { brand, meta };
  }

  function mountFooter(element) {
    let footer = element || document.querySelector('[data-ghrab-footer], .site-footer, .legal-footer, .app-owner-footer, .app-footer, #foot');
    if (!footer) {
      footer = document.createElement('footer');
      footer.dataset.ghrabFooter = 'true';
      (document.body || document.documentElement).append(footer);
    }
    const appendMode = footer.dataset.ghrabFooterMode === 'append';
    if (appendMode) {
      let slot = footer.querySelector('[data-ghrab-footer-branding]');
      if (!slot) {
        slot = document.createElement('div');
        slot.dataset.ghrabFooterBranding = 'true';
        footer.append(slot);
      }
      slot.className = 'ghrab-platform-footer__slot';
      slot.replaceChildren();
      const { brand, meta } = createFooterBranding();
      slot.append(brand, meta);
      footer.dataset.ghrabFooter = 'true';
      footer.dataset.ghrabFooterMounted = 'true';
      footer.classList.add('ghrab-platform-footer-host');
      return footer;
    }
    if (footer.dataset.ghrabFooterMounted === 'true') return footer;
    const preservedLinks = Array.from(footer.querySelectorAll('a[href]'))
      .map((link) => ({ href: link.getAttribute('href'), text: (link.textContent || '').trim(), target: link.getAttribute('target'), rel: link.getAttribute('rel') }))
      .filter((link, index, rows) => link.href && link.text && rows.findIndex((candidate) => candidate.href === link.href && candidate.text === link.text) === index);
    footer.dataset.ghrabFooter = 'true';
    footer.dataset.ghrabFooterMounted = 'true';
    footer.classList.add('ghrab-platform-footer');
    footer.replaceChildren();
    const { brand, meta } = createFooterBranding();
    footer.append(brand, meta);
    if (preservedLinks.length) {
      const links = document.createElement('nav');
      links.className = 'ghrab-platform-footer__links';
      links.setAttribute('aria-label', 'Doplňkové odkazy');
      for (const item of preservedLinks) {
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.text;
        if (item.target) link.target = item.target;
        link.rel = item.rel || (item.target === '_blank' ? 'noopener noreferrer' : '');
        links.append(link);
      }
      footer.append(links);
    }
    return footer;
  }

  function renderCompatibilityError() {
    if (compatibility.ok || document.getElementById('ghrab-platform-compatibility-error')) return;
    const panel = document.createElement('section');
    panel.id = 'ghrab-platform-compatibility-error';
    panel.className = 'ghrab-platform-compatibility-error';
    panel.setAttribute('role', 'alert');
    const heading = document.createElement('strong');
    heading.textContent = 'Nekompatibilní platformní vrstva';
    const message = document.createElement('span');
    message.textContent = `Aplikace vyžaduje ${compatibility.requiredRange}, načtena je verze ${compatibility.platformVersion}. Aktualizujte nejprve AI Studio GHRAB a potom tuto aplikaci.`;
    panel.append(heading, message);
    document.body.prepend(panel);
  }

  function showUpdateBanner(registration) {
    if (!registration || !registration.waiting || document.getElementById('ghrab-update-banner')) return;
    const banner = document.createElement('aside');
    banner.id = 'ghrab-update-banner';
    banner.className = 'ghrab-update-banner';
    banner.setAttribute('role', 'status');
    const message = document.createElement('span');
    const heading = document.createElement('strong');
    heading.textContent = 'Je dostupná nová verze.';
    message.append(heading, document.createTextNode(' Uložte rozpracovanou práci a obnovte aplikaci.'));
    const actions = document.createElement('div');
    const updateNow = document.createElement('button');
    updateNow.type = 'button';
    updateNow.dataset.ghrabUpdateNow = 'true';
    updateNow.textContent = 'Aktualizovat';
    const updateLater = document.createElement('button');
    updateLater.type = 'button';
    updateLater.dataset.ghrabUpdateLater = 'true';
    updateLater.textContent = 'Později';
    actions.append(updateNow, updateLater);
    banner.append(message, actions);
    updateNow.addEventListener('click', () => {
      registration.waiting.postMessage({ type: 'GHRAB_SKIP_WAITING' });
    });
    updateLater.addEventListener('click', () => banner.remove());
    document.body.append(banner);
  }

  async function setupUpdateProtocol() {
    if (!('serviceWorker' in navigator)) return;
    let registration;
    try {
      registration = await navigator.serviceWorker.getRegistration();
    } catch (_) {
      return;
    }
    if (!registration) return;
    showUpdateBanner(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(registration);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  }



  /* P3: shared accessibility, performance and lazy-module runtime. */
  const A11Y_CONTRACT = 'ghrab-a11y-v1';
  const PERFORMANCE_CONTRACT = 'ghrab-performance-v1';
  const MODULE_CONTRACT = 'ghrab-lazy-modules-v1';
  const FOCUSABLE_SELECTOR = [
    'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'object', 'embed',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  let liveRegion = null;
  let activeDialog = null;
  let activeDialogCleanup = null;
  let dialogObserver = null;

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element.closest('[hidden], [aria-hidden="true"], .hidden')) return false;
    const style = global.getComputedStyle ? global.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
    return true;
  }

  function focusableElements(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => isVisible(element) && element.getAttribute('aria-hidden') !== 'true');
  }

  function humaniseIdentifier(value) {
    return String(value || '')
      .replace(/([a-zá-ž])([A-ZÁ-Ž])/g, '$1 $2')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\b(btn|input|select|field|control|value|text|custom|note)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasAccessibleName(element) {
    if (!element) return false;
    if (element.getAttribute('aria-label')?.trim() || element.getAttribute('aria-labelledby')?.trim()) return true;
    if (element.id) {
      try {
        const escaped = global.CSS?.escape ? global.CSS.escape(element.id) : element.id.replace(/["\\]/g, '\\$&');
        if (document.querySelector(`label[for="${escaped}"]`)) return true;
      } catch (_) {}
    }
    if (element.closest?.('label')) return true;
    if (element.tagName === 'BUTTON' || element.tagName === 'A') return Boolean((element.textContent || '').replace(/\s+/g, ' ').trim());
    return false;
  }

  function inferredControlLabel(element) {
    const labels = config.accessibility?.labels || {};
    const key = element.id || element.name || '';
    const configured = labels[key];
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    const described = element.getAttribute('data-label') || element.getAttribute('placeholder') || element.getAttribute('title');
    if (described?.trim()) return described.trim();
    const field = element.closest?.('.field, .form-field, .input-group, .control, .row, .setting, .form-row');
    const nearby = field?.querySelector?.('label, .label, .field-label, .form-label, legend, h3, h4');
    const nearbyText = (nearby?.textContent || '').replace(/\s+/g, ' ').trim();
    if (nearbyText && nearbyText.length <= 120) return nearbyText;
    return humaniseIdentifier(key) || (element.tagName === 'SELECT' ? 'Výběr hodnoty' : element.tagName === 'TEXTAREA' ? 'Textové pole' : 'Vstupní pole');
  }

  function enhanceAccessibleNames(rootNode) {
    const root = rootNode?.querySelectorAll ? rootNode : document;
    let controls = 0;
    let images = 0;
    root.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href]').forEach((element) => {
      if (hasAccessibleName(element)) return;
      const label = inferredControlLabel(element);
      if (!label) return;
      element.setAttribute('aria-label', label);
      element.dataset.ghrabAutoLabel = 'true';
      controls += 1;
    });
    root.querySelectorAll('img:not([alt])').forEach((image) => {
      const title = image.getAttribute('title') || image.getAttribute('aria-label');
      const src = image.getAttribute('src') || '';
      image.setAttribute('alt', title || humaniseIdentifier(src.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '')) || '');
      image.dataset.ghrabAutoAlt = 'true';
      images += 1;
    });
    return { controls, images };
  }

  function ensureDialogName(dialog) {
    if (!dialog || dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby')) return;
    const heading = dialog.querySelector('h1, h2, h3, [role="heading"], .modal-title, .dialog-title');
    if (heading) {
      if (!heading.id) heading.id = `ghrab-dialog-title-${Math.random().toString(36).slice(2, 10)}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    } else {
      dialog.setAttribute('aria-label', 'Dialog aplikace');
    }
  }

  function releaseActiveDialog() {
    if (typeof activeDialogCleanup === 'function') activeDialogCleanup();
    activeDialogCleanup = null;
    activeDialog = null;
  }

  function trapDialog(dialog, options) {
    if (!dialog || dialog.dataset.ghrabFocusTrap === 'off') return () => {};
    if (activeDialog === dialog && activeDialogCleanup) return activeDialogCleanup;
    releaseActiveDialog();
    ensureDialogName(dialog);
    dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
    dialog.setAttribute('aria-modal', dialog.getAttribute('aria-modal') || 'true');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keydown = (event) => {
      if (activeDialog !== dialog || !isVisible(dialog)) return;
      if (event.key === 'Tab') {
        const focusables = focusableElements(dialog);
        if (!focusables.length) {
          event.preventDefault();
          if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
          dialog.focus({ preventScroll: true });
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
      if (event.key === 'Escape' && !event.defaultPrevented && dialog.dataset.ghrabEscapeClose === 'true') {
        const close = dialog.querySelector('[data-close], [data-dismiss], .close, .modal-close, .preview-close, [aria-label*="Zavř" i], [aria-label*="Close" i]');
        if (close instanceof HTMLElement) { event.preventDefault(); close.click(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    activeDialog = dialog;
    dialog.dataset.ghrabA11yTrapped = 'true';
    const initial = focusableElements(dialog)[0] || dialog;
    if (!dialog.contains(document.activeElement)) {
      if (initial === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      queueMicrotask(() => { try { initial.focus({ preventScroll: true }); } catch (_) {} });
    }
    const cleanup = () => {
      document.removeEventListener('keydown', keydown, true);
      delete dialog.dataset.ghrabA11yTrapped;
      if (activeDialog === dialog) activeDialog = null;
      if (previous && document.contains(previous)) queueMicrotask(() => { try { previous.focus({ preventScroll: true }); } catch (_) {} });
    };
    activeDialogCleanup = cleanup;
    return cleanup;
  }

  function scanDialogs(rootNode) {
    const root = rootNode?.querySelectorAll ? rootNode : document;
    const dialogs = Array.from(root.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]'));
    dialogs.forEach((dialog) => {
      ensureDialogName(dialog);
      const close = dialog.querySelector('[data-close], [data-dismiss], .close, .modal-close, .preview-close, [aria-label*="Zavř" i], [aria-label*="Close" i]');
      if (close && !dialog.hasAttribute('data-ghrab-escape-close')) dialog.dataset.ghrabEscapeClose = 'true';
    });
    const visible = dialogs.filter(isVisible).pop();
    if (visible) trapDialog(visible);
    else if (activeDialog && !isVisible(activeDialog)) releaseActiveDialog();
    return dialogs.length;
  }

  function ensureSkipLink() {
    const main = document.querySelector('main, [role="main"]');
    if (!main || document.querySelector('[data-ghrab-skip-link]')) return null;
    if (!main.id) main.id = 'ghrab-main';
    const link = document.createElement('a');
    link.href = `#${main.id}`;
    link.className = 'ghrab-skip-link';
    link.dataset.ghrabSkipLink = 'true';
    link.textContent = document.documentElement.lang === 'en' ? 'Skip to main content' : 'P\u0159esko\u010dit na hlavn\u00ed obsah';
    (document.body || document.documentElement).prepend(link);
    return link;
  }

  function ensureLiveRegion() {
    if (liveRegion && document.contains(liveRegion)) return liveRegion;
    liveRegion = document.getElementById('ghrab-a11y-live-region');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'ghrab-a11y-live-region';
      liveRegion.className = 'ghrab-sr-only';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      (document.body || document.documentElement).append(liveRegion);
    }
    return liveRegion;
  }

  function announce(message, options) {
    const region = ensureLiveRegion();
    region.setAttribute('aria-live', options?.assertive ? 'assertive' : 'polite');
    region.textContent = '';
    global.setTimeout(() => { region.textContent = String(message || ''); }, 20);
  }

  function enhanceAccessibility(rootNode) {
    const names = enhanceAccessibleNames(rootNode || document);
    ensureLiveRegion();
    ensureSkipLink();
    const dialogs = scanDialogs(rootNode || document);
    if (!dialogObserver && document.body) {
      let scheduled = false;
      dialogObserver = new MutationObserver((mutations) => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          const roots = new Set(mutations.map((item) => item.target instanceof Element ? item.target : document));
          for (const root of roots) enhanceAccessibleNames(root);
          scanDialogs(document);
        });
      });
      dialogObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'aria-modal', 'style'] });
    }
    document.documentElement.dataset.ghrabA11y = A11Y_CONTRACT;
    return { contract: A11Y_CONTRACT, names, dialogs };
  }

  function perfMark(name, detail) {
    const label = String(name || '').startsWith('ghrab-') ? String(name) : `ghrab-${String(name || 'mark')}`;
    try { global.performance?.mark?.(label, detail ? { detail } : undefined); } catch (_) {}
    return label;
  }

  function perfMeasure(name, start, end) {
    const label = String(name || '').startsWith('ghrab-') ? String(name) : `ghrab-${String(name || 'measure')}`;
    try { global.performance?.measure?.(label, start, end); } catch (_) {}
    return global.performance?.getEntriesByName?.(label)?.at?.(-1) || null;
  }

  function performanceSnapshot() {
    const nav = global.performance?.getEntriesByType?.('navigation')?.[0];
    const resources = global.performance?.getEntriesByType?.('resource') || [];
    const memory = global.performance?.memory;
    return Object.freeze({
      contract: PERFORMANCE_CONTRACT,
      now: global.performance?.now?.() || 0,
      domContentLoadedMs: nav?.domContentLoadedEventEnd || null,
      loadMs: nav?.loadEventEnd || null,
      transferBytes: resources.reduce((sum, entry) => sum + Number(entry.transferSize || 0), 0),
      decodedBytes: resources.reduce((sum, entry) => sum + Number(entry.decodedBodySize || 0), 0),
      jsHeapUsedBytes: memory?.usedJSHeapSize || null,
      resourceCount: resources.length,
    });
  }

  function whenIdle(callback, timeout) {
    if (typeof global.requestIdleCallback === 'function') return global.requestIdleCallback(callback, { timeout: Number(timeout || 1200) });
    return global.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0);
  }

  const loadedModules = new Map();
  function loadScript(url, options) {
    const absolute = new URL(String(url), location.href).href;
    if (loadedModules.has(absolute)) return loadedModules.get(absolute);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = absolute;
      script.async = false;
      if (options?.module) script.type = 'module';
      if (options?.integrity) { script.integrity = options.integrity; script.crossOrigin = 'anonymous'; }
      script.dataset.ghrabLazyModule = options?.name || absolute;
      script.addEventListener('load', () => resolve(script), { once: true });
      script.addEventListener('error', () => reject(new Error(`GHRAB lazy module failed: ${absolute}`)), { once: true });
      (document.head || document.documentElement).append(script);
    });
    loadedModules.set(absolute, promise);
    return promise;
  }

  function loadStyle(url) {
    const absolute = new URL(String(url), location.href).href;
    if (loadedModules.has(absolute)) return loadedModules.get(absolute);
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = absolute; link.dataset.ghrabLazyModule = absolute;
      link.addEventListener('load', () => resolve(link), { once: true });
      link.addEventListener('error', () => reject(new Error(`GHRAB lazy style failed: ${absolute}`)), { once: true });
      (document.head || document.documentElement).append(link);
    });
    loadedModules.set(absolute, promise);
    return promise;
  }


  function bootstrapDom() {
    initialiseTheme();
    syncLegacyThemeClasses();
    if (config.autoFooter !== false && !document.documentElement.hasAttribute('data-ghrab-no-footer') && !document.body?.hasAttribute('data-ghrab-no-footer')) mountFooter();
    renderCompatibilityError();
    enhanceAccessibility(document);
    setupUpdateProtocol();
    perfMark('platform:ready', { appId, appVersion, platformVersion: PLATFORM_VERSION });
    perfMeasure('platform:boot', 'ghrab-platform:start', 'ghrab-platform:ready');
    try {
      document.dispatchEvent(new CustomEvent('ghrab:platform-ready', { detail: { appId, appVersion, platformVersion: PLATFORM_VERSION } }));
    } catch (_) {}
  }

  const api = Object.freeze({
    version: PLATFORM_VERSION,
    contract: CONTRACT,
    appId,
    appVersion,
    config,
    compatibility,
    storageMigration,
    storageAliases,
    satisfies,
    compareVersions,
    namespace,
    migrateStorage,
    rollbackStorageMigration,
    theme: Object.freeze({ getContext: getThemeContext, set: applyTheme, normalise: normaliseTheme }),
    bridge: Object.freeze({ schema: HANDOFF_SCHEMA, key: HANDOFF_KEY, legacyKey: LEGACY_HANDOFF_KEY, validate: validateHandoff, peek: peekHandoff, take: takeHandoff, create: createHandoff, recordEvent: recordBridgeEvent }),
    unlockProtectedScripts,
    artifact: Object.freeze({ schema: ARTIFACT_SCHEMA, create: createArtifactEnvelope, validate: validateArtifactEnvelope, parse: parseArtifactEnvelope, isEnvelope: isArtifactEnvelope, unwrap: unwrapArtifact, unwrapMaybe: unwrapMaybeArtifact, download: downloadArtifact, stableStringify, sha256 }),
    mountFooter,
    logoUrl,
    a11y: Object.freeze({ contract: A11Y_CONTRACT, enhance: enhanceAccessibility, enhanceNames: enhanceAccessibleNames, scanDialogs, trapDialog, releaseDialog: releaseActiveDialog, announce, liveRegion: ensureLiveRegion, skipLink: ensureSkipLink, focusables: focusableElements }),
    performance: Object.freeze({ contract: PERFORMANCE_CONTRACT, mark: perfMark, measure: perfMeasure, snapshot: performanceSnapshot, whenIdle }),
    modules: Object.freeze({ contract: MODULE_CONTRACT, loadScript, loadStyle, whenIdle, loaded: loadedModules }),
  });

  global.GHRAB_PLATFORM = api;
  global.GHRABArtifact = api.artifact;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrapDom, { once: true });
  else bootstrapDom();
})(window);
