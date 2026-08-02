const CONFIG_KEY = 'lesson-hub-server-config-v1';
const SESSION_KEY = 'lesson-hub-server-session-v1';
const DEFAULT_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:8787',
  rememberSession: false,
  syncEnabled: false,
  lastCursor: 0,
  clientId: '',
});

function storage(kind) {
  try { return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage; } catch { return null; }
}

function randomClientId() {
  if (globalThis.crypto?.randomUUID) return `client_${globalThis.crypto.randomUUID()}`;
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}



function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/$/, '');
  if (!text) throw new Error('Adresa serveru je povinná.');
  let url;
  try { url = new URL(text); } catch { throw new Error('Adresa serveru není platná.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Server musí používat HTTP nebo HTTPS.');
  return url.toString().replace(/\/$/, '');
}

function readJsonStore(target, key, fallback) {
  try { return { ...fallback, ...JSON.parse(target?.getItem(key) || '{}') }; } catch { return { ...fallback }; }
}

export class ServerApiError extends Error {
  constructor(message, { status = 0, code = 'server_error', payload = null } = {}) {
    super(message);
    this.name = 'ServerApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export class ServerService {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    const local = storage('local');
    this.config = readJsonStore(local, CONFIG_KEY, DEFAULT_CONFIG);
    if (!this.config.clientId) this.config.clientId = randomClientId();
    this.session = this.#loadSession();
    this.profile = this.session?.user || null;
    this.healthState = null;
    this.saveConfig();
  }

  #loadSession() {
    const local = readJsonStore(storage('local'), SESSION_KEY, {});
    const temporary = readJsonStore(storage('session'), SESSION_KEY, {});
    const candidate = temporary.token ? temporary : local.token ? local : null;
    if (!candidate?.token) return null;
    if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= Date.now()) {
      this.clearSession();
      return null;
    }
    return candidate;
  }

  saveConfig(patch = {}) {
    this.config = { ...this.config, ...patch };
    storage('local')?.setItem(CONFIG_KEY, JSON.stringify(this.config));
    return this.config;
  }

  configure(input = {}) {
    return this.saveConfig({
      baseUrl: normalizeBaseUrl(input.baseUrl ?? this.config.baseUrl),
      rememberSession: input.rememberSession ?? this.config.rememberSession,
      syncEnabled: input.syncEnabled ?? this.config.syncEnabled,
    });
  }

  setCursor(cursor) {
    this.saveConfig({ lastCursor: Math.max(0, Number(cursor) || 0) });
  }

  saveSession(session, remember = this.config.rememberSession) {
    this.clearSession();
    const target = storage(remember ? 'local' : 'session');
    target?.setItem(SESSION_KEY, JSON.stringify(session));
    this.session = session;
    this.profile = session.user || null;
  }

  clearSession() {
    storage('local')?.removeItem(SESSION_KEY);
    storage('session')?.removeItem(SESSION_KEY);
    this.session = null;
    this.profile = null;
  }

  get isAuthenticated() { return Boolean(this.session?.token && this.profile); }
  get role() { return this.profile?.role || ''; }
  get canManageUsers() { return ['owner', 'admin'].includes(this.role); }
  get canReadAudit() { return ['owner', 'admin'].includes(this.role); }
  get canManageOperations() { return ['owner', 'admin'].includes(this.role); }
  get canRestoreServerBackup() { return this.role === 'owner'; }

  async #request(path, { method = 'GET', body, auth = true, timeout = 6000 } = {}) {
    if (!this.fetchImpl) throw new ServerApiError('Síťové rozhraní není dostupné.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(`${normalizeBaseUrl(this.config.baseUrl)}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-lesson-hub-client': this.config.clientId,
          ...(auth && this.session?.token ? { authorization: `Bearer ${this.session.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && auth) this.clearSession();
        throw new ServerApiError(payload?.message || `Server odpověděl stavem ${response.status}.`, { status: response.status, code: payload?.error, payload });
      }
      return payload;
    } catch (error) {
      if (error instanceof ServerApiError) throw error;
      if (error.name === 'AbortError') throw new ServerApiError('Server neodpověděl v časovém limitu.', { code: 'timeout' });
      throw new ServerApiError('Se serverem se nepodařilo spojit.', { code: 'network_error', payload: { cause: error.message } });
    } finally {
      clearTimeout(timer);
    }
  }


  async #requestBinary(path, { timeout = 10000 } = {}) {
    if (!this.fetchImpl) throw new ServerApiError('Síťové rozhraní není dostupné.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(`${normalizeBaseUrl(this.config.baseUrl)}${path}`, {
        signal: controller.signal,
        headers: {
          'x-lesson-hub-client': this.config.clientId,
          ...(this.session?.token ? { authorization: `Bearer ${this.session.token}` } : {}),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ServerApiError(payload?.message || `Server odpověděl stavem ${response.status}.`, { status: response.status, code: payload?.error, payload });
      }
      return { blob: await response.blob(), contentType: response.headers.get('content-type') || 'application/octet-stream', disposition: response.headers.get('content-disposition') || '' };
    } catch (error) {
      if (error instanceof ServerApiError) throw error;
      if (error.name === 'AbortError') throw new ServerApiError('Server neodpověděl v časovém limitu.', { code: 'timeout' });
      throw new ServerApiError('Přílohu se nepodařilo stáhnout.', { code: 'network_error', payload: { cause: error.message } });
    } finally { clearTimeout(timer); }
  }

  async health() {
    this.healthState = await this.#request('/health', { auth: false, timeout: 3500 });
    return this.healthState;
  }

  async login({ email, password, rememberSession = false }) {
    const payload = await this.#request('/v1/auth/login', { method: 'POST', auth: false, body: { email, password } });
    this.configure({ rememberSession });
    this.saveSession({ token: payload.token, expiresAt: payload.expiresAt, user: payload.user }, rememberSession);
    return payload.user;
  }

  async restoreSession() {
    if (!this.session?.token) return null;
    try {
      const payload = await this.#request('/v1/auth/me', { timeout: 3500 });
      this.session = { ...this.session, expiresAt: payload.expiresAt, user: payload.user };
      this.saveSession(this.session, this.config.rememberSession);
      return payload.user;
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  async logout() {
    try { if (this.session?.token) await this.#request('/v1/auth/logout', { method: 'POST' }); } finally { this.clearSession(); }
  }

  async serverInfo() { return this.#request('/v1/server/info'); }
  async listResource(resource) { return (await this.#request(`/v1/${encodeURIComponent(resource)}`)).items || []; }
  async listUsers() { return (await this.#request('/v1/users')).items || []; }
  async createUser(input) { return (await this.#request('/v1/users', { method: 'POST', body: input })).user; }
  async updateUser(id, input) { return (await this.#request(`/v1/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })).user; }
  async audit(limit = 100) { return (await this.#request(`/v1/audit?limit=${Math.min(500, Math.max(1, limit))}`)).items || []; }
  async push(changes) { return this.#request('/v1/sync/push', { method: 'POST', body: { schema: 'lesson-hub-sync-v1', clientId: this.config.clientId, changes } }); }
  async pull({ since = this.config.lastCursor, limit = 500 } = {}) { return this.#request(`/v1/sync/pull?since=${Math.max(0, Number(since) || 0)}&limit=${Math.min(1000, Math.max(1, limit))}`); }


  async listAttachments() { return (await this.#request('/v1/attachments')).items || []; }

  async uploadAttachment(file, { purpose = 'material', visibility = 'private' } = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new ServerApiError('Vyberte platný soubor.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const payload = await this.#request('/v1/attachments/upload', {
      method: 'POST', timeout: 20000,
      body: { fileName: file.name || 'soubor', mimeType: file.type || 'application/octet-stream', contentBase64: bytesToBase64(bytes), purpose, visibility },
    });
    return payload;
  }

  async downloadAttachment(id) { return this.#requestBinary(`/v1/attachments/${encodeURIComponent(id)}/content`); }
  async deleteAttachment(id) { return this.#request(`/v1/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async processDueMessages() { return (await this.#request('/v1/messages/process-due', { method: 'POST', body: {} })).items || []; }
  async mailStatus() { return this.#request('/v1/mail/status'); }
  async listServerMessages() { return (await this.#request('/v1/messages')).items || []; }
  async saveServerMessage(message) {
    if (!message?.id) throw new ServerApiError('Zpráva nemá identifikátor.');
    try { return await this.#request(`/v1/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: message }); }
    catch (error) { if (error.status !== 404) throw error; return this.#request('/v1/messages', { method: 'POST', body: message }); }
  }
  async approveServerMessage(id) { return (await this.#request(`/v1/messages/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} })).message; }
  async sendServerMessage(id) { return this.#request(`/v1/messages/${encodeURIComponent(id)}/send`, { method: 'POST', body: {} , timeout: 30000 }); }
  async retryServerMessage(id) { return this.#request(`/v1/messages/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {}, timeout: 30000 }); }
  async listDeliveries(messageId = '') { return (await this.#request(`/v1/deliveries${messageId ? `?messageId=${encodeURIComponent(messageId)}` : ''}`)).items || []; }

  async listSubstitutionPeriods() { return (await this.#request('/v1/substitution/periods')).items || []; }
  async listActiveSubstitutions() { return (await this.#request('/v1/substitution/active')).items || []; }
  async createSubstitutionPeriod(input) { return (await this.#request('/v1/substitution/periods', { method: 'POST', body: input })).period; }
  async updateSubstitutionPeriod(id, input) { return (await this.#request(`/v1/substitution/periods/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })).period; }
  async substitutionSummary(id) { return (await this.#request(`/v1/substitution/periods/${encodeURIComponent(id)}/summary`)).item; }
  async markSubstitutionImported(id, itemIds) { return this.#request(`/v1/substitution/periods/${encodeURIComponent(id)}/imported`, { method: 'POST', body: { itemIds } }); }
  async createSubstitutionPlan(input) { return (await this.#request('/v1/substitution/plans', { method: 'POST', body: input })).plan; }
  async updateSubstitutionPlan(id, input) { return (await this.#request(`/v1/substitution/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })).plan; }
  async createSubstitutionItem(input) { return (await this.#request('/v1/substitution/items', { method: 'POST', body: input })).item; }
  async updateSubstitutionItem(id, input) { return (await this.#request(`/v1/substitution/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })).item; }

  async operationsStatus() { return (await this.#request('/v1/operations/status')).status; }
  async listServerBackups() { return (await this.#request('/v1/operations/backups')).items || []; }
  async createServerBackup(reason = 'manual') { return (await this.#request('/v1/operations/backups', { method: 'POST', body: { reason }, timeout: 30000 })).backup; }
  async restoreServerBackup(id) {
    const result = await this.#request(`/v1/operations/backups/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {}, timeout: 60000 });
    if (result?.sessionsInvalidated) this.clearSession();
    return result;
  }
  async deleteServerBackup(id) { return (await this.#request(`/v1/operations/backups/${encodeURIComponent(id)}`, { method: 'DELETE', timeout: 30000 })).backup; }
  async runServerMaintenance({ createBackup = false, processMessages = true } = {}) { return this.#request('/v1/operations/maintenance', { method: 'POST', body: { createBackup, processMessages }, timeout: 60000 }); }
  async getPrivacyPolicy() { return (await this.#request('/v1/privacy/policy')).policy; }
  async updatePrivacyPolicy(input) { return (await this.#request('/v1/privacy/policy', { method: 'PUT', body: input })).policy; }
  async previewPrivacyPurge(scope = 'self') { return this.#request('/v1/privacy/purge', { method: 'POST', body: { commit: false, scope } }); }
  async commitPrivacyPurge(scope = 'self') { return this.#request('/v1/privacy/purge', { method: 'POST', body: { commit: true, scope } }); }

}
