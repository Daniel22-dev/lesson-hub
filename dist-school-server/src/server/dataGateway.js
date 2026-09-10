/**
 * Stabilní datový kontrakt Lesson Hubu pro budoucí serverovou verzi.
 * Prezentační a doménové služby nesmí být závislé na konkrétním transportu.
 */
export class DataGateway {
  async list(_resource, _query = {}) { throw new Error('DataGateway.list není implementováno.'); }
  async get(_resource, _id) { throw new Error('DataGateway.get není implementováno.'); }
  async create(_resource, _payload) { throw new Error('DataGateway.create není implementováno.'); }
  async update(_resource, _id, _payload) { throw new Error('DataGateway.update není implementováno.'); }
  async remove(_resource, _id) { throw new Error('DataGateway.remove není implementováno.'); }
}

export class LocalRepositoryGateway extends DataGateway {
  constructor(repositories) {
    super();
    this.repositories = repositories;
    this.kind = 'local-repository';
  }

  #repository(resource) {
    const repository = this.repositories[resource];
    if (!repository) throw new Error(`Neznámý lokální datový zdroj: ${resource}`);
    return repository;
  }

  async list(resource) { return this.#repository(resource).list(); }
  async get(resource, id) { return this.#repository(resource).get(id); }
  async create(resource, payload) { return this.#repository(resource).create(payload); }
  async update(resource, id, payload) { return this.#repository(resource).update(id, payload); }
  async remove(resource, id) { return this.#repository(resource).remove(id); }
}

export class HttpApiGateway extends DataGateway {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, tokenProvider = () => '' } = {}) {
    super();
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this.kind = 'http-api';
  }

  async #request(path, options = {}) {
    if (!this.baseUrl) throw new Error('Serverové API zatím není nakonfigurováno.');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(this.tokenProvider() ? { authorization: `Bearer ${this.tokenProvider()}` } : {}), ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`Serverové API odpovědělo stavem ${response.status}.`);
    return response.status === 204 ? null : response.json();
  }

  async list(resource, query = {}) {
    const search = new URLSearchParams(query);
    return this.#request(`/v1/${encodeURIComponent(resource)}${search.size ? `?${search}` : ''}`);
  }
  async get(resource, id) { return this.#request(`/v1/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`); }
  async create(resource, payload) { return this.#request(`/v1/${encodeURIComponent(resource)}`, { method: 'POST', body: JSON.stringify(payload) }); }
  async update(resource, id, payload) { return this.#request(`/v1/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
  async remove(resource, id) { return this.#request(`/v1/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}

export const SERVER_API_CONTRACT = Object.freeze({
  version: 'lesson-hub-api-v1',
  basePath: '/v1',
  resources: ['schoolYears', 'subjects', 'groupIdentities', 'groupInstances', 'lessons', 'quickNotes', 'tasks', 'reminders', 'materials', 'materialLinks', 'tags', 'entityTags', 'students', 'lessonTemplates', 'teachingCycles', 'messageTemplates', 'messages', 'messageDeliveries', 'attachmentLinks', 'substitutionPeriods', 'substitutionPlans', 'substitutionItems'],
  syncEnvelope: {
    schema: 'lesson-hub-sync-v1',
    required: ['id', 'entityType', 'entityId', 'operation', 'createdAt', 'payload'],
  },
});
