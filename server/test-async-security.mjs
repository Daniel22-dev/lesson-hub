#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { hashPasswordAsync, verifyPasswordAsync } from './lib/security.mjs';
const encoded = await hashPasswordAsync('AsyncPassword1234');
assert.equal(await verifyPasswordAsync('AsyncPassword1234', encoded), true);
assert.equal(await verifyPasswordAsync('wrong-password', encoded), false);
console.log('Lesson Hub async scrypt: PASS');

const storeSource = await readFile(new URL('./lib/store.mjs', import.meta.url), 'utf8');
assert.match(storeSource, /await syncDirectory\(path\.dirname\(this\.filePath\)\)/, 'Store must fsync the containing directory after rename.');
console.log('Directory fsync regression passed.');
