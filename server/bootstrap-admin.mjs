import { parseArgs } from 'node:util';
import { loadServerConfig } from './lib/config.mjs';
import { createStore } from './lib/storeFactory.mjs';
import { hashPassword, normalizeEmail } from './lib/security.mjs';
import { randomUUID } from 'node:crypto';
import { normalizeOpenedStore } from './lib/storeNormalization.mjs';

const { values } = parseArgs({ options: {
  email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'owner' },
} });
const email = normalizeEmail(values.email || process.env.ADMIN_EMAIL);
const password = process.env.ADMIN_PASSWORD;
const displayName = String(values.name || process.env.ADMIN_NAME || 'Správce Lesson Hubu').trim();
if (!email || !password) {
  console.error('Nastavte ADMIN_EMAIL a ADMIN_PASSWORD v prostředí. Heslo se z bezpečnostních důvodů nepředává v argumentu příkazu.');
  process.exit(1);
}
const config = loadServerConfig();
const store = await createStore(config).open();
const normalization = normalizeOpenedStore(store);
if (normalization.changed > 0) await store.save();
if (store.data.users.some((user) => user.email === email)) {
  console.error('Účet s tímto e-mailem již existuje.');
  process.exit(1);
}
const now = new Date().toISOString();
store.data.users.push({
  id: `user_${randomUUID()}`, email, displayName, role: values.role === 'admin' ? 'admin' : 'owner',
  status: 'active', passwordHash: hashPassword(password), createdAt: now, updatedAt: now, lastLoginAt: null,
});
await store.save();
console.log(`Vytvořen účet ${email} (${values.role === 'admin' ? 'admin' : 'owner'}).`);
