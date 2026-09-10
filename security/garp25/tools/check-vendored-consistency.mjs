#!/usr/bin/env node
// GARP 2.5.1 GHRAB - check-vendored-consistency
// EW-03 / EW-04 mely v GARP 2.5 jen textovy popis. Tohle je jejich vynutitelna podoba.
// Ekosystem GHRAB vendoruje platformu, app-guard a error-reporter do kazde aplikace;
// bezpecnostni oprava sdilene vrstvy je hotova az tehdy, kdyz je ve VSECH kopiich.
//
// Konfigurace (JSON):
// {
//   "schema": "ghrab-vendored-consistency-v1",
//   "canonicalRoot": "../AI-Studio-GHRAB",
//   "components": [
//     { "id": "platform", "canonical": "src/ghrab-platform.js", "severity": "CRITICAL" },
//     { "id": "error-reporter", "canonical": "src/error-reporter.js", "severity": "HIGH" }
//   ],
//   "consumers": [
//     { "appId": "korespondencni-asistent", "root": "../KS",
//       "copies": { "platform": ["src/vendor/ghrab-platform.js", "dist/vendor/ghrab-platform.js"] } }
//   ]
// }
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [cfgPath] = process.argv.slice(2);
if (!cfgPath) { console.error('Usage: node check-vendored-consistency.mjs <config.json>'); process.exit(2); }
const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
if (cfg.schema !== 'ghrab-vendored-consistency-v1') { console.error('config schema'); process.exit(2); }
const base = path.dirname(path.resolve(cfgPath));
const hex = b => createHash('sha256').update(b).digest('hex');
const abs = (root, rel) => path.resolve(base, root, rel);

const canonical = new Map();
const findings = [];
for (const c of cfg.components) {
  try { canonical.set(c.id, { sha: hex(await readFile(abs(cfg.canonicalRoot, c.canonical))), severity: c.severity || 'HIGH' }); }
  catch { findings.push({ severity: 'CRITICAL', component: c.id, issue: 'canonical-unreadable', detail: c.canonical }); }
}

const report = [];
for (const consumer of cfg.consumers) {
  for (const [componentId, paths] of Object.entries(consumer.copies || {})) {
    const canon = canonical.get(componentId);
    if (!canon) { findings.push({ severity: 'HIGH', appId: consumer.appId, component: componentId, issue: 'no-canonical-declared' }); continue; }
    if (!paths.length) findings.push({ severity: 'HIGH', appId: consumer.appId, component: componentId, issue: 'no-copy-declared' });
    for (const rel of paths) {
      let sha = null;
      try { sha = hex(await readFile(abs(consumer.root, rel))); }
      catch { findings.push({ severity: canon.severity, appId: consumer.appId, component: componentId, issue: 'copy-missing', detail: rel }); continue; }
      const match = sha === canon.sha;
      report.push({ appId: consumer.appId, component: componentId, path: rel, sha256: sha, match });
      if (!match) findings.push({ severity: canon.severity, appId: consumer.appId, component: componentId, issue: 'DRIFT', detail: rel, observed: sha, expected: canon.sha });
    }
  }
  // aplikace, ktera nema deklarovanou kopii povinne komponenty, je take nalez
  for (const c of cfg.components) {
    if (c.required !== false && !(consumer.copies || {})[c.id])
      findings.push({ severity: c.severity || 'HIGH', appId: consumer.appId, component: c.id, issue: 'component-not-declared-in-consumer' });
  }
}

const blocking = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
const out = {
  status: blocking.length ? 'FAIL' : (findings.length ? 'AMBER' : 'PASS'),
  canonicalRoot: cfg.canonicalRoot,
  components: [...canonical.entries()].map(([id, v]) => ({ id, sha256: v.sha })),
  checkedCopies: report.length,
  drift: report.filter(r => !r.match).length,
  findings
};
console[blocking.length ? 'error' : 'log'](JSON.stringify(out, null, 2));
process.exit(blocking.length ? 1 : 0);
