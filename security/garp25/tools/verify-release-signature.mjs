#!/usr/bin/env node
// GARP 2.5.1 GHRAB - verify-release-signature
// Zmena proti 2.5: podpis se overuje proti trust rootu, ne proti libovolnemu PEM
// predanemu na prikazove radce. Vynucuje vazbu manifest.signature.keyId -> klic,
// stav klice (active/revoked) a casove okno platnosti. Fail-closed.
import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';

const [manifestPath, sigPath, trustRootPath] = process.argv.slice(2);
if (!manifestPath || !sigPath || !trustRootPath) {
  console.error('Usage: node verify-release-signature.mjs <manifest> <signature> <trust-root.json>');
  process.exit(2);
}
const errors = [];
const raw = await readFile(manifestPath);
let manifest; try { manifest = JSON.parse(raw.toString('utf8')); } catch { deny(['manifest-unreadable']); }

let trust; try { trust = JSON.parse(await readFile(trustRootPath, 'utf8')); } catch { deny(['trust-root-unreadable']); }
if (trust.schema !== 'ghrab-trust-root-v1') deny(['trust-root-schema']);

const keyId = manifest?.signature?.keyId;
const alg = manifest?.signature?.algorithm;
if (!keyId) deny(['manifest-keyId-missing']);
if (alg !== 'Ed25519') deny([`manifest-algorithm:${alg}`]);

const entry = (trust.keys || []).find(k => k.keyId === keyId);
if (!entry) deny([`unknown-keyId:${keyId}`]);
if (entry.algorithm !== 'Ed25519') errors.push('trust-entry-algorithm');
if (entry.status !== 'active') errors.push(`key-status:${entry.status || 'missing'}`);

const now = new Date();
if (entry.notBefore && now < new Date(entry.notBefore)) errors.push('key-not-yet-valid');
if (entry.notAfter && now > new Date(entry.notAfter)) errors.push('key-expired');
if (errors.length) deny(errors);

let key;
try {
  key = createPublicKey(entry.publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') deny(['trust-key-not-ed25519']);
} catch { deny(['trust-key-unparseable']); }

let sig;
try { sig = Buffer.from((await readFile(sigPath, 'utf8')).trim(), 'base64'); } catch { deny(['signature-unreadable']); }
if (sig.length !== 64) deny([`signature-length:${sig.length}`]);
if (!verify(null, raw, key, sig)) deny(['SIGNATURE_INVALID']);

console.log(JSON.stringify({ status: 'VERIFIED', algorithm: 'Ed25519', keyId, keyStatus: entry.status }, null, 2));

function deny(errs) {
  console.error(JSON.stringify({ status: 'UNVERIFIED', errors: errs }, null, 2));
  process.exit(1);
}
