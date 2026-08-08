import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export function normalizeEmail(value) {
  return String(value || '').trim().toLocaleLowerCase('cs');
}

function passwordError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'password_weak' });
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) throw passwordError('Heslo musí mít alespoň 12 znaků.');
  if (!/[a-zá-ž]/i.test(value) || !/[0-9]/.test(value)) throw passwordError('Heslo musí obsahovat písmeno a číslici.');
  return value;
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const value = validatePassword(password);
  const hash = scryptSync(value, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashPasswordAsync(password, salt = randomBytes(16).toString('hex')) {
  const value = validatePassword(password);
  const hash = await scryptAsync(value, salt, 64);
  return `scrypt:${salt}:${Buffer.from(hash).toString('hex')}`;
}

export async function verifyPasswordAsync(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = Buffer.from(await scryptAsync(String(password || ''), salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function constantTimeTokenEqual(left, right) {
  const actual = Buffer.from(tokenDigest(left), 'hex');
  const expected = Buffer.from(tokenDigest(right), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}
