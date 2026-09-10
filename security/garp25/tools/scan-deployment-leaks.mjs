#!/usr/bin/env node
import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanSecretBuffer } from './secret-scan-common.mjs';

const root = path.resolve(process.argv[2] || 'dist');
const forbiddenDirs = new Set([
  '.git', '.github', '.svn', '.hg', '.vscode', '.idea', 'test', 'tests', '__tests__',
  'test-results', 'coverage', 'audit-evidence', 'PROMPTY', 'node_modules', '.claude'
]);
const forbiddenNames = new Set([
  'SHA256SUMS.private', 'private-key.pem', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc', '.DS_Store'
]);
const forbiddenExt = new Set(['.map', '.pem', '.key', '.p12', '.pfx', '.p8', '.jks', '.keystore', '.kdb', '.ppk', '.asc', '.gpg', '.der', '.bak', '.orig']);
const errors = [];
const info = [];

async function scanFile(abs, rel) {
  const result = scanSecretBuffer(await readFile(abs), rel);
  for (const label of result.hits) errors.push(`secret-pattern:${rel}:${label}`);
  if (result.binary && result.hits.length === 0) info.push(`binary-no-private-key-detected:${rel}`);
}
async function walk(dir, base = '') {
  for (const name of (await readdir(dir)).sort()) {
    const abs = path.join(dir, name), rel = path.posix.join(base, name);
    const st = await lstat(abs);
    if (st.isSymbolicLink()) { errors.push(`symlink:${rel}`); continue; }
    if (st.isDirectory()) {
      if (forbiddenDirs.has(name)) errors.push(`forbidden-dir:${rel}`);
      else await walk(abs, rel);
      continue;
    }
    if (!st.isFile()) { errors.push(`irregular-file:${rel}`); continue; }
    if (forbiddenNames.has(name)) errors.push(`forbidden-name:${rel}`);
    if (name === '.env' || name.startsWith('.env.')) errors.push(`forbidden-env-file:${rel}`);
    if (forbiddenExt.has(path.extname(name).toLowerCase())) errors.push(`forbidden-ext:${rel}`);
    await scanFile(abs, rel);
  }
}
await walk(root);
const hard = [...new Set(errors)];
if (hard.length) { console.error(JSON.stringify({ status: 'FAIL', errors: hard, info: [...new Set(info)] }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ status: 'PASS', root, info: [...new Set(info)] }, null, 2));
