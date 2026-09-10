import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createLessonHubServer } from './app.mjs';
import { loadServerConfig, validateUpstreamAuthSecret } from './lib/config.mjs';
import { hashPassword } from './lib/security.mjs';

const SECRET = 'd394aca9c490f20f066b26ef6c265b4270da933926e7965d5f4748aed1f7e836';
assert.equal(validateUpstreamAuthSecret({}), '');
for (const value of [
  '',
  'short-secret',
  'a'.repeat(32),
  'a'.repeat(64),
  'this-is-a-readable-secret-phrase-with-more-than-forty-three-characters',
  '0123456789abcdef'.repeat(4),
  'REPLACE_WITH_SAME_VALUE_AS_GHRAB_SECRET_0123456789abcdef',
  'change_me_0123456789abcdef0123456789abcdef0123456789abcdef',
]) {
  assert.throws(() => validateUpstreamAuthSecret({ LESSON_HUB_GHRAB_UPSTREAM_SECRET: value }), /LESSON_HUB_GHRAB_UPSTREAM_SECRET/);
}
assert.equal(validateUpstreamAuthSecret({ LESSON_HUB_GHRAB_UPSTREAM_SECRET: SECRET }), SECRET);
assert.equal(loadServerConfig({}).upstreamAuthSecret, '');
assert.throws(() => loadServerConfig({ LESSON_HUB_GHRAB_UPSTREAM_SECRET: '' }), /LESSON_HUB_GHRAB_UPSTREAM_SECRET/);

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-gateway-hardening-'));
const config = {
  ...loadServerConfig({ LESSON_HUB_GHRAB_UPSTREAM_SECRET: SECRET }),
  host: '127.0.0.1', port: 0, dataFile: path.join(dir, 'server.json'), attachmentsDir: path.join(dir, 'attachments'),
};
const { server, store } = await createLessonHubServer({ config });
const now = new Date().toISOString();
store.data.users.push({
  id: 'user_owner', email: 'owner@example.invalid', displayName: 'Owner', role: 'owner', status: 'active',
  passwordHash: hashPassword('OwnerGatewayTest1234'), createdAt: now, updatedAt: now, lastLoginAt: null,
});
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const upstreamHeaders = ({ roles = 'teacher', externalId = 'synthetic.teacher@example.invalid', expires = new Date(Date.now() + 5 * 60_000).toISOString() } = {}) => ({
  'x-ghrab-upstream-secret': SECRET,
  'x-ghrab-user-id': encodeURIComponent(externalId),
  'x-ghrab-user-name': encodeURIComponent('Synthetic Teacher'),
  'x-ghrab-user-roles': roles,
  'x-ghrab-session-expires-at': expires,
});
const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : null;
  return { response, body };
};

try {
  let result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ roles: 'owner,admin' }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.role, 'teacher', 'Unsigned upstream role header must not mint owner/admin privileges.');
  const ssoUserId = result.body.user.id;

  result = await jsonRequest(`${base}/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.invalid', password: 'OwnerGatewayTest1234' }),
  });
  assert.equal(result.response.status, 200);
  const ownerAuth = { authorization: `Bearer ${result.body.token}`, 'content-type': 'application/json' };

  result = await jsonRequest(`${base}/v1/users/${encodeURIComponent(ssoUserId)}`, {
    method: 'PATCH', headers: ownerAuth, body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(result.response.status, 400, 'SSO account promotion to admin must fail closed.');

  const ssoUser = store.data.users.find((item) => item.id === ssoUserId);
  assert.ok(ssoUser);
  ssoUser.role = 'admin';
  ssoUser.updatedAt = new Date().toISOString();
  await store.save();
  result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders() });
  assert.equal(result.response.status, 403, 'Legacy privileged SSO record must not be usable through the shared upstream secret.');
  ssoUser.role = 'teacher';
  await store.save();

  result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ externalId: 'owner@example.invalid' }) });
  assert.equal(result.response.status, 409, 'SSO identity must not collide with an existing local account email.');
  for (const variant of ['owner@example.invalid.', 'owner+x@example.invalid', 'öwner@example.invalid']) {
    result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ externalId: variant }) });
    assert.equal(result.response.status, 400, `Non-canonical/confusable SSO email must be rejected: ${variant}`);
  }

  // N25: an SSO identity must remain gateway-only. Offboarding is status=disabled, never adding a local password.
  result = await jsonRequest(`${base}/v1/users/${encodeURIComponent(ssoUserId)}`, {
    method: 'PATCH', headers: ownerAuth, body: JSON.stringify({ password: 'SyntheticLocalPassword1234' }),
  });
  assert.equal(result.response.status, 400, 'SSO account must not receive a local password.');

  result = await jsonRequest(`${base}/v1/audit`, { headers: upstreamHeaders({ roles: 'owner' }) });
  assert.equal(result.response.status, 403, 'Forged owner header must not grant audit access.');

  result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ roles: 'substitute' }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.role, 'substitute');

  result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ expires: new Date(Date.now() - 60_000).toISOString() }) });
  assert.equal(result.response.status, 401, 'Expired upstream session assertion must fail closed.');

  result = await jsonRequest(`${base}/v1/auth/me`, { headers: upstreamHeaders({ expires: new Date(Date.now() + 60 * 60_000).toISOString() }) });
  assert.equal(result.response.status, 401, 'Unbounded upstream session assertion must fail closed.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({
  status: 'PASS',
  contract: 'lesson-hub-gateway-auth-hardening-v3',
  strongSecretRequired: true,
  privilegedSsoForbidden: true,
  ssoEmailCollisionRejected: true,
  nonCanonicalSsoEmailRejected: true,
  ssoLocalPasswordForbidden: true,
  obviousRepeatedSecretsRejected: true,
  unsignedPrivilegedHeaderRejected: true,
  expiryBounded: true,
}, null, 2));
