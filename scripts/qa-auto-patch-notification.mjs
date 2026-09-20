#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const deploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const promotion = readFileSync(new URL('../.github/workflows/safe-promotion.yml', import.meta.url), 'utf8');
const fail = (m) => { console.error(`[AUTO-PATCH-TOPOLOGY] FAIL: ${m}`); process.exit(1); };
for (const [source, required, label] of [
  [deploy, 'workflow_run:', 'deploy must be chained from P5 workflow_run'],
  [deploy, "head_branch == 'main'", 'deploy must accept only main P5'],
  [deploy, 'Verify AI Studio dispatch credential', 'dispatch credential preflight'],
  [deploy, 'prepare:pages', 'exact release identity preparation'],
  [deploy, 'Verify the live release before notifying AI Studio', 'bounded live verification'],
  [deploy, 'Dispatch app-updated event to AI Studio', 'app-updated dispatch'],
  [deploy, 'AI_STUDIO_DISPATCH_TOKEN', 'dispatch secret'],
  [promotion, 'workflow_run:', 'Safe Promotion controller'],
  [promotion, 'SAFE_PROMOTION_TOKEN', 'promotion credential'],
  [promotion, "head_branch == 'candidate'", 'candidate-only promotion source'],
  [promotion, 'rules/branches/main', 'runtime ruleset verification'],
  [promotion, 'p5-release-gate', 'P5 required gate'],
]) if (!source.includes(required)) fail(label);
if (/head_branch\s*==\s*['"]candidate['"][\s\S]{0,200}(?:deploy|publish)/i.test(deploy)) fail('candidate must never deploy to production');
if (deploy.includes('git push origin HEAD:main')) fail('deploy must never push to main');
if (promotion.includes('git push origin HEAD:main')) fail('promotion controller must merge through PR, not direct-push main');
if (!deploy.includes("event_type: 'app-updated'") && !deploy.includes('build-ai-studio-dispatch.mjs')) fail('dispatch contract is not built from verified live release');
console.log('[AUTO-PATCH-TOPOLOGY] PASS: candidate -> full P5 -> PR -> protected main -> P5 -> Pages -> live verification -> app-updated.');
