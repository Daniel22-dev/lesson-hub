#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
const fail = (message) => { console.error(`[SAFE-PROMOTION] FAIL: ${message}`); process.exit(1); };
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const deploy = read('.github/workflows/deploy.yml');
const p5 = read('.github/workflows/p5-release-gate.yml');
const safe = read('.github/workflows/safe-promotion.yml');
if (!deploy.includes('workflow_run:') || !deploy.includes('workflows: ["P5 R2 pre-production release gate"]')) fail('deploy must be chained from the P5 workflow');
if (!deploy.includes("github.event.workflow_run.head_branch == 'main'")) fail('deploy must accept only a GREEN main P5 source');
if (!deploy.includes("github.event_name == 'workflow_dispatch' && github.ref_name == 'main'")) fail('manual deploy must reject non-main refs');
if (/head_branch\s*==\s*['"]candidate['"]/.test(deploy)) fail('candidate must never be a production deploy source');
if (!/push:[\s\S]*branches:\s*\[candidate, main\]/.test(p5)) fail('P5 workflow must run on candidate and main pushes');
if (!/pull_request:\s*\n\s*branches:\s*\[main\]/.test(p5)) fail('P5 pull-request gate must target main');
for (const required of ['candidate-to-main:', 'open-promotion-pr:', 'merge-promotion-pr:', 'SAFE_PROMOTION_TOKEN', 'rules/branches/main']) if (!safe.includes(required)) fail(`Safe Promotion controller missing ${required}`);
const head = process.env.SAFE_PROMOTION_HEAD || '';
const base = process.env.SAFE_PROMOTION_BASE || '';
if (head || base) {
  if (base !== 'main') fail(`unexpected base branch: ${base || '<empty>'}`);
  if (head !== 'candidate') fail(`only candidate may promote to main; got ${head || '<empty>'}`);
}
console.log('[SAFE-PROMOTION] PASS: candidate -> P5 -> PR -> required checks -> protected main -> main P5 -> deploy.');
