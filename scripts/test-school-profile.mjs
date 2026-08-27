import assert from 'node:assert/strict';

class MemoryStorage {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

const local = new MemoryStorage({ 'lesson-hub-server-session-v1': JSON.stringify({ token: 'legacy-local-token' }) });
const session = new MemoryStorage({ 'lesson-hub-server-session-v1': JSON.stringify({ token: 'legacy-session-token' }) });
globalThis.localStorage = local;
globalThis.sessionStorage = session;
globalThis.GHRAB_PLATFORM = {
  isSchoolProfile: () => true,
  apiUrl: (relative) => `https://school.example/api/v1/${relative}`,
  getDeployment: () => ({ profile: 'school-server', apiBaseUrl: '/api/v1/' }),
  getSession: () => ({
    authenticated: true,
    requestToken: 'memory.request.token',
    expiresAt: '2026-08-04T20:00:00.000Z',
    user: { sub: 'teacher-hash', displayName: 'Test Teacher', roles: ['teacher'], role: 'teacher' },
  }),
};
let logoutCalls = 0;
globalThis.GHRABServerAuth = { getSession: globalThis.GHRAB_PLATFORM.getSession, logout: async () => { logoutCalls += 1; return true; } };
const requests = [];
const fetchImpl = async (url, init = {}) => {
  requests.push({ url: String(url), init });
  return new Response(JSON.stringify({ status: 'ok', version: 'test', apiContract: 'lesson-hub-api-v1' }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { ServerService } = await import('../src/services/serverService.js');
const service = new ServerService({ fetchImpl });
assert.equal(service.schoolProfile, true);
assert.equal(service.config.baseUrl, 'https://school.example/api/v1/lesson-hub');
assert.equal(service.isAuthenticated, true);
assert.equal(service.profile.displayName, 'Test Teacher');
assert.equal(local.getItem('lesson-hub-server-session-v1'), null);
assert.equal(session.getItem('lesson-hub-server-session-v1'), null);
await service.health();
assert.equal(requests[0].url, 'https://school.example/api/v1/lesson-hub/health');
assert.equal(requests[0].init.credentials, 'include');
assert.equal(requests[0].init.headers.authorization, 'Bearer memory.request.token');
assert.equal(requests[0].init.headers['x-ghrab-csrf'], 'memory.request.token');
assert.equal(local.getItem('lesson-hub-server-session-v1'), null);
await service.logout();
assert.equal(logoutCalls, 1);
assert.equal(service.isAuthenticated, false);
console.log('PASS: Lesson Hub school profile uses central memory-only session and stores no bearer token.');
