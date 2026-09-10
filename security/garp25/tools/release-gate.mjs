#!/usr/bin/env node
// GARP 2.5.1 GHRAB - release gate, tooling hardening R2.
// Fail-closed orchestration. If a deployed service worker exists, the gate MUST run
// sw-security-freeze with the authoritative security-critical-assets list.
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const profile = opt('profile') || 'school';
const deployArg = opt('deploy');

const REQUIRED = {
  school: ['deploy', 'manifest', 'signature', 'trust-root', 'registry', 'artifact', 'provenance', 'evidence-dir', 'evidence-manifest'],
  prep: ['deploy', 'manifest', 'signature', 'trust-root']
};
if (!REQUIRED[profile]) {
  console.error(JSON.stringify({ status: 'FAIL', errors: [`unknown-profile:${profile}`] }, null, 2));
  process.exit(2);
}

const steps = [];
const skippedSteps = [];
const missing = [];
for (const k of REQUIRED[profile]) {
  const v = opt(k);
  if (!v) { missing.push(k); continue; }
  try { await access(v); } catch { missing.push(`${k}:${v}:unreadable`); }
}
if (missing.length) failEarly('required-input-missing', { missing });

const deployRoot = path.resolve(deployArg);
const explicitSw = opt('sw');
const detectedSw = path.join(deployRoot, 'sw.js');
let swPath = null;
if (explicitSw) {
  try { await access(explicitSw); swPath = path.resolve(explicitSw); }
  catch { failEarly('service-worker-unreadable', { sw: explicitSw }); }
} else if (existsSync(detectedSw)) {
  swPath = detectedSw;
}

let criticalList = null;
if (swPath) {
  const candidates = [
    opt('critical-list'),
    path.join(path.dirname(deployRoot), 'security', 'security-critical-assets.json')
  ].filter(Boolean);
  for (const c of candidates) {
    try { await access(c); criticalList = path.resolve(c); break; } catch {}
  }
  if (!criticalList) failEarly('critical-asset-list-missing', {
    sw: swPath,
    searched: candidates.length ? candidates : ['--critical-list', '<project-root>/security/security-critical-assets.json']
  });
}

run('deployment-leaks', 'scan-deployment-leaks.mjs', [deployArg]);
run('release-integrity', 'verify-release-integrity.mjs', [deployArg, opt('manifest')]);
run('release-signature', 'verify-release-signature.mjs', [opt('manifest'), opt('signature'), opt('trust-root')]);
if (opt('registry')) run('release-registry', 'verify-release-registry.mjs', [opt('manifest'), opt('registry')]);
else skippedSteps.push({ step: 'release-registry', reason: 'registry-not-provided' });
if (opt('artifact') && opt('provenance'))
  run('build-provenance', 'verify-build-provenance.mjs',
    [opt('artifact'), opt('provenance'), ...(profile === 'prep' ? ['--allow-local-builder'] : [])]);
else skippedSteps.push({ step: 'build-provenance', reason: 'artifact-or-provenance-not-provided' });
if (opt('evidence-dir') && opt('evidence-manifest'))
  run('evidence-manifest', 'verify-evidence-manifest.mjs', [opt('evidence-dir'), opt('evidence-manifest'), ...(opt('project-root') ? ['--project-root', opt('project-root')] : [])]);
else skippedSteps.push({ step: 'evidence-manifest', reason: 'evidence-inputs-not-provided' });

const projectRoot = opt('project-root') ? path.resolve(opt('project-root')) : null;
let aiFingerprint = opt('ai-fingerprint');
let aiInventory = opt('ai-inventory');
if (projectRoot) {
  const defaultFingerprint = path.join(projectRoot, 'security', 'evidence', 'ai-assurance-fingerprint.json');
  const defaultInventory = path.join(projectRoot, 'security', 'ai-boundary-files.json');
  if (!aiFingerprint && existsSync(defaultFingerprint)) aiFingerprint = defaultFingerprint;
  if (!aiInventory && existsSync(defaultInventory)) aiInventory = defaultInventory;
}
if (aiFingerprint || aiInventory) {
  if (!projectRoot || !aiFingerprint || !aiInventory) failEarly('ai-assurance-inputs-incomplete', { projectRoot, aiFingerprint, aiInventory });
  run('ai-assurance-fingerprint', 'verify-ai-assurance-fingerprint.mjs', [aiFingerprint, aiInventory, projectRoot]);
} else skippedSteps.push({ step: 'ai-assurance-fingerprint', reason: 'no-ai-assurance-inputs-detected' });

const assuranceScript = path.join(here, 'verify-assurance-links.mjs');
if (existsSync(assuranceScript)) {
  run('assurance-links', 'verify-assurance-links.mjs', [
    '--manifest', opt('manifest'),
    ...(opt('provenance') ? ['--provenance', opt('provenance')] : []),
    ...(opt('evidence-manifest') ? ['--evidence-manifest', opt('evidence-manifest')] : []),
    ...(opt('sbom') ? ['--sbom', opt('sbom')] : []),
    ...(opt('deployment-package') ? ['--deployment-package', opt('deployment-package')] : []),
  ]);
} else skippedSteps.push({ step: 'assurance-links', reason: 'verifier-not-present-in-this-tooling-profile' });
if (swPath) run('sw-security-freeze', 'check-sw-security-freeze.mjs', [swPath, deployArg, criticalList]);
else skippedSteps.push({ step: 'sw-security-freeze', reason: 'service-worker-not-present' });
if (opt('vendored-config')) run('vendored-consistency', 'check-vendored-consistency.mjs', [opt('vendored-config')]);
else skippedSteps.push({ step: 'vendored-consistency', reason: 'vendored-config-not-provided' });

const failed = steps.filter(s => s.status !== 'PASS');
const verdict = {
  gate: 'GARP-2.5.1-RELEASE-GATE-R2',
  profile,
  status: failed.length ? 'RED' : 'GREEN',
  serviceWorker: swPath,
  criticalAssetList: criticalList,
  stepsRun: steps.length,
  steps,
  skippedSteps,
  note: profile === 'prep'
    ? 'PREP profil muze pouzit lokalni builder. Vystup vzdy uvadi stepsRun a skippedSteps; GREEN bez uvedeni rozsahu se nesmi interpretovat jako plny SHIELD-PREP. Pokud deployment obsahuje service worker, SW kontrola a autoritativni critical-asset list jsou povinne. Neni to school-server LIVE GREEN.'
    : 'School profil: povinne vstupy jsou fail-closed; service worker se nesmi overovat bez autoritativniho seznamu kritickych assetu.'
};
console[failed.length ? 'error' : 'log'](JSON.stringify(verdict, null, 2));
process.exit(failed.length ? 1 : 0);

function run(name, script, args) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8' });
  const text = (r.status === 0 ? r.stdout : (r.stderr || r.stdout)).trim();
  const reportedAmber = /"status"\s*:\s*"AMBER"/.test(text);
  steps.push({
    step: name,
    script,
    status: r.status === 0 ? 'PASS' : (reportedAmber ? 'AMBER' : 'FAIL'),
    exitCode: r.status,
    detail: text.slice(0, 1200)
  });
}
function failEarly(reason, extra = {}) {
  console.error(JSON.stringify({ gate: 'GARP-2.5.1-RELEASE-GATE-R2', status: 'RED', profile, errors: [reason], ...extra }, null, 2));
  process.exit(1);
}
