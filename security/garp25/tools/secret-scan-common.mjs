#!/usr/bin/env node
import { createHash, createPrivateKey } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';

const MAX_DECODED = 16 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ENCODING_DEPTH = 4;
const PRIVATE_LABELS = new Set([
  'private-key-pem', 'pgp-private-key', 'jwk-private-key', 'der-private-key',
  'encoded-private-key', 'gzip-private-key', 'zip-private-key', 'archive-unscannable',
]);

const textRules = [
  { id: 'google-api-key-like', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'github-token-like', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'openai-like-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'stripe-live-secret', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'credential-url', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/:@]+:[^\s@\/]{8,}@/gi },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'garp-canary', re: /GHRAB_CANARY_[A-Z0-9_]+/g },
];
const assignedQuoted = /(?:^|[^A-Za-z0-9_])(?:["']?)(api[_-]?key|apikey|client[_-]?secret|clientsecret|smtp[_-]?password|smtppassword|aws[_-]?secret[_-]?access[_-]?key|awssecretaccesskey|secret|passwd|password|token)(?:["']?)\s*[:=]\s*(["'`])([^"'`\r\n]{12,})\2/gi;
const assignedBareLine = /(?:^|[;,{}])[ \t]*(?:-[ \t]*)?(?:process\.env\.)?["']?([A-Za-z0-9_.-]{1,96})["']?[ \t]*[:=][ \t]*([A-Za-z0-9_+\/@.=-]{12,512})/gim;
const sensitiveKey = /(?:^|[._-])(?:api[_-]?key|apikey|client[_-]?secret|clientsecret|smtp[_-]?password|smtppassword|aws[_-]?secret[_-]?access[_-]?key|awssecretaccesskey|secret|passwd|password|token)$/i;
const fromCharCodeLiteral = /String\.fromCharCode\(\s*((?:\d{1,3}\s*,\s*){5,}\d{1,3})\s*\)/g;
const joinedStringArray = /\[((?:\s*["'][A-Za-z0-9+\/_=-]{2,}["']\s*,?){2,})\]\s*\.join\(\s*["']["']\s*\)/gs;
const btoaLiteral = /\bbtoa\s*\(\s*(["'`])([^"'`\r\n]{3,})\1\s*\)/g;
const base64Candidate = /(?<![A-Za-z0-9+\/_-])([A-Za-z0-9+\/_-]{40,32768}={0,2})(?![A-Za-z0-9+\/_-])/g;
const hexCandidate = /(?<![0-9A-Fa-f])([0-9A-Fa-f]{80,32768})(?![0-9A-Fa-f])/g;

function pemPrivateKey(text) {
  return /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text);
}
function pgpPrivateKey(text) {
  return text.includes('-----BEGIN ' + 'PGP PRIVATE KEY ' + 'BLOCK-----');
}
function jwkPrivateKey(text) {
  const variants = [text, text.replace(/\\(["'])/g, '$1')];
  for (const value of variants) {
    const kty = /(?:["']?kty["']?)\s*:\s*["'](?:EC|OKP|RSA)["']/i;
    const d = /(?:["']?d["']?)\s*:\s*["'][A-Za-z0-9_-]{20,}["']/i;
    const km = kty.exec(value), dm = d.exec(value);
    if (km && dm && Math.abs(km.index - dm.index) <= 4096) return true;
  }
  return false;
}
function normalizeBase64(value) {
  const std = value.replace(/-/g, '+').replace(/_/g, '/');
  return std + (std.length % 4 ? '='.repeat(4 - (std.length % 4)) : '');
}
function stripOuterQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'") || (text[0] === '`' && text.at(-1) === '`'))) return text.slice(1, -1).trim();
  return text;
}
function obviousNonSecret(value) {
  const v = stripOuterQuotes(value);
  if (!v || v.length < 12) return true;
  if (/^(?:true|false|null|undefined|yes|no|on|off|none|nil)$/i.test(v)) return true;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(v)) return true;
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(v)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(v)) return true;
  if (/^<[^>]+>$/.test(v)) return true;
  if (/^(?:REPLACE[_-]?WITH|CHANGE[_-]?ME|CHANGEME|PLACEHOLDER|YOUR[_-]|EXAMPLE(?:[_-]|$)|DUMMY(?:[_-]|$)|TODO(?:[_-]|$))/i.test(v)) return true;
  return false;
}
function bareAssignedSecret(text) {
  assignedBareLine.lastIndex = 0;
  for (let m; (m = assignedBareLine.exec(text));) {
    const key = String(m[1] || '').replace(/^process\.env\./i, '');
    if (!sensitiveKey.test(key)) continue;
    if (!obviousNonSecret(m[2])) return true;
  }
  return false;
}
function derivedLiteralSecret(text) {
  btoaLiteral.lastIndex = 0;
  for (let m; (m = btoaLiteral.exec(text));) {
    const raw = String(m[2]); const colon = raw.indexOf(':'); const tail = colon >= 0 ? raw.slice(colon + 1) : '';
    if (colon >= 0 && raw.length >= 12 && tail.length >= 8 && !/^(?:password|heslo|secret|token|example|placeholder)$/i.test(tail)) return true;
  }
  fromCharCodeLiteral.lastIndex = 0;
  for (let m; (m = fromCharCodeLiteral.exec(text));) {
    const nums = m[1].split(',').map((x) => Number.parseInt(x.trim(), 10));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
    const decoded = String.fromCharCode(...nums);
    for (const rule of textRules) { rule.re.lastIndex = 0; if (rule.re.test(decoded)) return true; }
    if (/^[A-Za-z0-9_+\/=.-]{20,}$/.test(decoded) && /[A-Za-z]/.test(decoded) && /\d/.test(decoded)) return true;
  }
  return false;
}
function joinedEncodedPrivateMaterial(text) {
  joinedStringArray.lastIndex = 0;
  for (let m; (m = joinedStringArray.exec(text));) {
    const pieces = [];
    const pieceRe = /["']([A-Za-z0-9+\/_=-]{2,})["']/g;
    for (let p; (p = pieceRe.exec(m[1]));) pieces.push(p[1]);
    const joined = pieces.join('');
    if (pieces.length >= 2 && joined.length >= 40 && encodedPrivateMaterial(joined)) return true;
  }
  return false;
}
function privateDer(buffer) {
  if (!buffer?.length || buffer.length > MAX_DECODED) return false;
  for (const type of ['pkcs8', 'pkcs1', 'sec1']) {
    try { createPrivateKey({ key: buffer, format: 'der', type }); return true; } catch {}
  }
  return false;
}
function directPrivate(buffer) {
  if (privateDer(buffer)) return true;
  const text = buffer.toString('utf8');
  return pemPrivateKey(text) || pgpPrivateKey(text) || jwkPrivateKey(text);
}
function fingerprint(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function encodedPrivateMaterial(text, depth = 0, seen = new Set()) {
  if (depth >= MAX_ENCODING_DEPTH) return false;
  const candidates = [];
  base64Candidate.lastIndex = 0;
  for (let m, n = 0; (m = base64Candidate.exec(text)) && n < 512; n += 1) {
    if (m[1].length % 4 === 1) continue;
    try { candidates.push(Buffer.from(normalizeBase64(m[1]), 'base64')); } catch {}
  }
  hexCandidate.lastIndex = 0;
  for (let m, n = 0; (m = hexCandidate.exec(text)) && n < 512; n += 1) {
    if (m[1].length % 2) continue;
    try { candidates.push(Buffer.from(m[1], 'hex')); } catch {}
  }
  for (const decoded of candidates) {
    if (!decoded.length || decoded.length > MAX_DECODED) continue;
    const fp = fingerprint(decoded);
    if (seen.has(fp)) continue;
    seen.add(fp);
    if (directPrivate(decoded)) return true;
    const nestedText = decoded.toString('utf8');
    if (encodedPrivateMaterial(nestedText, depth + 1, seen)) return true;
  }
  return false;
}
function scanText(text) {
  const hits = new Set();
  if (pemPrivateKey(text)) hits.add('private-key-pem');
  if (pgpPrivateKey(text)) hits.add('pgp-private-key');
  if (jwkPrivateKey(text)) hits.add('jwk-private-key');
  for (const rule of textRules) { rule.re.lastIndex = 0; if (rule.re.test(text)) hits.add(rule.id); }
  assignedQuoted.lastIndex = 0; if (assignedQuoted.test(text)) hits.add('assigned-secret-literal');
  if (bareAssignedSecret(text)) hits.add('assigned-secret-bare');
  if (derivedLiteralSecret(text)) hits.add('derived-secret-literal');
  if (encodedPrivateMaterial(text) || joinedEncodedPrivateMaterial(text)) hits.add('encoded-private-key');
  return hits;
}

function readZipEntries(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip-eocd-missing');
  const disk = buffer.readUInt16LE(eocd + 4), cdDisk = buffer.readUInt16LE(eocd + 6);
  const total = buffer.readUInt16LE(eocd + 10), cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || total === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64-or-multidisk-unsupported');
  if (total > MAX_ARCHIVE_ENTRIES) throw new Error('zip-too-many-entries');
  const out = []; let pos = cdOffset; let totalOut = 0;
  for (let i = 0; i < total; i += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip-central-directory-invalid');
    const flags = buffer.readUInt16LE(pos + 8), method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20), uncompSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28), extraLen = buffer.readUInt16LE(pos + 30), commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error('zip-encrypted-entry');
    if (name.endsWith('/')) continue;
    if (uncompSize > MAX_DECODED || compSize > MAX_DECODED) throw new Error('zip-entry-too-large');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip-local-header-invalid');
    const localNameLen = buffer.readUInt16LE(localOffset + 26), localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: MAX_DECODED });
    else throw new Error(`zip-method-${method}-unsupported`);
    totalOut += data.length;
    if (totalOut > MAX_ARCHIVE_TOTAL) throw new Error('zip-total-output-too-large');
    out.push({ name, data });
  }
  return out;
}

export function isPrivateKeyRule(id) {
  return PRIVATE_LABELS.has(id) || String(id).includes('private-key');
}

function scanSecretBufferInternal(buffer, relPath = '', depth = 0) {
  const hits = new Set();
  const ext = path.extname(String(relPath)).toLowerCase();
  const isZip = (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) || ext === '.zip' || ext === '.jar';
  if (isZip) {
    if (depth >= 3) return { hits: ['archive-unscannable'], findings: [{ path: relPath, rule: 'archive-unscannable' }], binary: true, compressed: true };
    try {
      const entries = readZipEntries(buffer);
      const findings = [];
      let nestedPrivate = false;
      for (const entry of entries) {
        const nested = scanSecretBufferInternal(entry.data, `${relPath}::${entry.name}`, depth + 1);
        for (const id of nested.hits) {
          hits.add(id);
          if (isPrivateKeyRule(id)) nestedPrivate = true;
        }
        findings.push(...(nested.findings || []));
      }
      if (nestedPrivate) {
        hits.add('zip-private-key');
        findings.push({ path: relPath, rule: 'zip-private-key' });
      }
      return { hits: [...hits], findings, binary: true, compressed: true, archiveEntries: entries.length };
    } catch {
      return { hits: ['archive-unscannable'], findings: [{ path: relPath, rule: 'archive-unscannable' }], binary: true, compressed: true };
    }
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      const inner = gunzipSync(buffer, { maxOutputLength: MAX_DECODED });
      const nested = scanSecretBufferInternal(inner, `${relPath}::gunzip`, depth + 1);
      const findings = [...(nested.findings || [])];
      let nestedPrivate = false;
      for (const id of nested.hits) { hits.add(id); if (isPrivateKeyRule(id)) nestedPrivate = true; }
      if (nestedPrivate) { hits.add('gzip-private-key'); findings.push({ path: relPath, rule: 'gzip-private-key' }); }
      return { hits: [...hits], findings, binary: false, compressed: true };
    } catch {
      return { hits: ['archive-unscannable'], findings: [{ path: relPath, rule: 'archive-unscannable' }], binary: true, compressed: true };
    }
  }
  const binary = buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
  if (ext === '.der' || binary) {
    if (privateDer(buffer)) hits.add('der-private-key');
    const list = [...hits];
    return { hits: list, findings: list.map((rule) => ({ path: relPath, rule })), binary: true, compressed: false };
  }
  const text = buffer.toString('utf8');
  for (const id of scanText(text)) hits.add(id);
  const list = [...hits];
  return { hits: list, findings: list.map((rule) => ({ path: relPath, rule })), binary: false, compressed: false };
}

export function scanSecretBuffer(buffer, relPath = '') {
  return scanSecretBufferInternal(Buffer.from(buffer), relPath, 0);
}

export function scanSecretText(text) {
  return [...scanText(String(text))];
}
