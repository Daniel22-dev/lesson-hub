import { loadState, saveState, saveGate, gateResult, finding, runCommand } from './qa-core.mjs';

const commands = [];
const findings = [];
for (const [command, label] of [
  ['npm run check', 'project-check'],
  ['npm run test:core', 'project-core'],
  ['npm run build', 'project-build'],
  ['npm run test:headless', 'project-headless'],
]) {
  const result = await runCommand(command, label);
  commands.push(result);
  if (result.code !== 0) findings.push(finding('project', 'BLOCKER', 'COMMAND_FAILED', `${label} selhal: ${command}`, result.log));
}
await saveGate(gateResult('project', findings, { commands }));
const state = await loadState();
state.skipped ||= [];
for (const item of [
  { check: 'npm-ci', reason: 'Interní npm registry pracovního kontejneru vrací HTTP 404; čistou instalaci je nutné zopakovat v GitHub Actions.' },
  { check: 'npm-audit', reason: 'Síťový audit není kvůli internímu npm registry v pracovním kontejneru dostupný; musí proběhnout v GitHub Actions.' },
]) {
  if (!state.skipped.some((entry) => entry.check === item.check)) state.skipped.push(item);
}
await saveState(state);
console.log(`PROJECT ${findings.length ? 'FAIL' : 'PASS'}: ${findings.length} nálezů`);
if (findings.length) process.exitCode = 1;
