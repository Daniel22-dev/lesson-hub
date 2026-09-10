#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
const [manifestPath, privateKeyPath, sigPath='release-integrity.sig'] = process.argv.slice(2);
if (!manifestPath || !privateKeyPath) { console.error('Usage: node sign-release-integrity.mjs <manifest> <private-key.pem> [signature]'); process.exit(2); }
const data=await readFile(manifestPath); const key=createPrivateKey(await readFile(privateKeyPath));
if (key.asymmetricKeyType!=='ed25519') throw new Error('Expected Ed25519 private key');
const signature=sign(null,data,key).toString('base64');
await writeFile(sigPath, signature+'\n','utf8');
console.log(JSON.stringify({signature:sigPath,algorithm:'Ed25519'},null,2));
