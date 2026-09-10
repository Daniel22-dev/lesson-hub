#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const workflows = path.join(root, '.github', 'workflows');
const findings = [];
let usesCount = 0;
let workflowFiles = 0;

function indentOf(line) {
  if (/\t/.test(line.slice(0, line.search(/\S|$/)))) throw new Error('tabs-in-yaml-indentation');
  return line.length - line.trimStart().length;
}
function mapEntry(line) {
  const m = line.match(/^(\s*)(?:-\s+)?["']?([A-Za-z0-9_-]+)["']?\s*:\s*(.*?)\s*$/);
  if (!m) return null;
  return { indent: m[1].length, key: m[2], value: m[3] };
}
function childBlock(lines, startIndex, parentIndent) {
  const out = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) { out.push([i, line]); continue; }
    const indent = indentOf(line);
    if (indent <= parentIndent) break;
    out.push([i, line]);
  }
  return out;
}
function simpleMap(lines, startIndex, parentIndent, label) {
  const map = new Map();
  for (const [i, line] of childBlock(lines, startIndex, parentIndent)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const e = mapEntry(line);
    if (!e || e.indent !== parentIndent + 2 || !e.value) {
      findings.push(`${label}:${i + 1}:unsupported-or-nested-permissions-yaml`);
      continue;
    }
    map.set(e.key, e.value.replace(/^['"]|['"]$/g, ''));
  }
  return map;
}
function sameMap(actual, expected) {
  if (actual.size !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([k, v]) => actual.get(k) === v);
}
function collectRun(lines, index, indent, value) {
  if (value && value !== '|' && value !== '>' && !value.startsWith('|') && !value.startsWith('>')) return value;
  const rows = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { rows.push(''); continue; }
    if (indentOf(line) <= indent) break;
    rows.push(line.trim());
  }
  return rows.join('\n');
}
function unsafeRunReason(run) {
  const normalized = String(run || '').replace(/\\\n/g, ' ');
  if (/\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:bash|sh|zsh|pwsh|powershell)\b/i.test(normalized)) return 'remote-download-piped-to-shell';
  if (/<\(\s*(?:curl|wget)\b/i.test(normalized)) return 'remote-process-substitution';
  if (/\b(?:source|\.)\s+<\(/i.test(normalized)) return 'process-substitution-sourced';
  if (/\beval\b/i.test(normalized)) return 'eval-forbidden-in-workflow-run';
  if (/\b(?:bash|sh|zsh)\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/i.test(normalized)) return 'remote-command-substitution';
  if (/\b(?:iwr|Invoke-WebRequest)\b[^\n|]{0,240}\|\s*(?:iex|Invoke-Expression)\b/i.test(normalized)) return 'powershell-remote-execution';
  if (/\b(?:iex|Invoke-Expression)\b[^\n]{0,240}\b(?:iwr|Invoke-WebRequest)\b/i.test(normalized)) return 'powershell-remote-execution';
  return null;
}

if (!fs.existsSync(workflows)) findings.push('workflows-missing');
else for (const name of fs.readdirSync(workflows).sort()) {
  const file = path.join(workflows, name);
  if (!fs.statSync(file).isFile() || !/\.ya?ml$/i.test(name)) continue;
  workflowFiles += 1;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  try {
    const topEntries = [];
    for (let i = 0; i < lines.length; i += 1) {
      const e = mapEntry(lines[i]);
      if (e && e.indent === 0) topEntries.push([i, e]);
    }
    const permissionsEntries = topEntries.filter(([, e]) => e.key === 'permissions');
    if (permissionsEntries.length !== 1) findings.push(`${name}:top-level-permissions-count:${permissionsEntries.length}`);
    else {
      const [i, e] = permissionsEntries[0];
      if (e.value) findings.push(`${name}:${i + 1}:top-level-permissions-must-be-explicit-map`);
      else {
        const perms = simpleMap(lines, i, 0, name);
        if (!sameMap(perms, { contents: 'read' })) findings.push(`${name}:top-level-permissions-not-exact-contents-read`);
      }
    }

    const onEntries = topEntries.filter(([, e]) => e.key === 'on');
    if (onEntries.length !== 1) findings.push(`${name}:on-block-count:${onEntries.length}`);
    else {
      const [i, e] = onEntries[0];
      if (/pull_request_target/.test(e.value)) findings.push(`${name}:${i + 1}:forbidden-trigger:pull_request_target`);
      for (const [j, line] of childBlock(lines, i, 0)) {
        const child = mapEntry(line);
        if (child && child.indent === 2 && child.key === 'pull_request_target') findings.push(`${name}:${j + 1}:forbidden-trigger:pull_request_target`);
      }
    }

    const jobsEntries = topEntries.filter(([, e]) => e.key === 'jobs');
    if (jobsEntries.length !== 1) findings.push(`${name}:jobs-block-count:${jobsEntries.length}`);
    else {
      const [jobsIndex, jobsEntry] = jobsEntries[0];
      if (jobsEntry.value) findings.push(`${name}:${jobsIndex + 1}:inline-jobs-yaml-not-supported`);
      const jobRows = childBlock(lines, jobsIndex, 0);
      const jobs = [];
      for (const [i, line] of jobRows) {
        const e = mapEntry(line);
        if (e && e.indent === 2 && !e.value) jobs.push([i, e.key]);
      }
      for (const [jobIndex, jobName] of jobs) {
        const block = childBlock(lines, jobIndex, 2);
        const permRows = block.filter(([, line]) => {
          const e = mapEntry(line); return e && e.indent === 4 && e.key === 'permissions';
        });
        if (permRows.length > 1) findings.push(`${name}:${jobName}:multiple-permissions-blocks`);
        if (permRows.length === 1) {
          const [pi, pline] = permRows[0];
          const pe = mapEntry(pline);
          if (pe.value) findings.push(`${name}:${pi + 1}:${jobName}:permissions-must-be-explicit-map`);
          else {
            const perms = simpleMap(lines, pi, 4, `${name}:${jobName}`);
            if (jobName === 'deploy') {
              if (!sameMap(perms, { contents: 'read', pages: 'write', 'id-token': 'write' })) findings.push(`${name}:${jobName}:permissions-not-exact-deploy-whitelist`);
            } else {
              for (const [k, v] of perms.entries()) if (v === 'write' || v === 'write-all' || k === 'write-all') findings.push(`${name}:${jobName}:forbidden-write-permission:${k}:${v}`);
              if (![...perms.entries()].every(([k, v]) => k === 'contents' && v === 'read')) findings.push(`${name}:${jobName}:job-permissions-exceed-read-only`);
            }
          }
        } else if (jobName === 'deploy') {
          findings.push(`${name}:deploy-missing-explicit-permissions`);
        }
      }
    }

    lines.forEach((line, index) => {
      const m = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      if (m) {
        usesCount += 1;
        const ref = m[1];
        if (!ref.startsWith('./')) {
          const at = ref.lastIndexOf('@');
          const rev = at >= 0 ? ref.slice(at + 1) : '';
          if (!/^[0-9a-f]{40}$/i.test(rev)) findings.push(`${name}:${index + 1}:unpinned-use:${ref}`);
        }
      }
      const e = mapEntry(line);
      if (e?.key === 'permissions' && /write-all/i.test(e.value)) findings.push(`${name}:${index + 1}:permissions-write-all`);
      const run = line.match(/^\s*(?:-\s+)?run:\s*(.*)$/);
      if (run) {
        const body = collectRun(lines, index, indentOf(line), run[1]);
        const unsafe = unsafeRunReason(body);
        if (unsafe) findings.push(`${name}:${index + 1}:${unsafe}`);
      }
      const runner = line.match(/^\s*runs-on:\s*(\S+)/)?.[1];
      if (runner === 'ubuntu-latest') findings.push(`${name}:${index + 1}:floating-runner:${runner}`);
      const nv = line.match(/^\s*node-version:\s*([^\s#]+)/)?.[1];
      if (nv && !/^\d+\.\d+\.\d+$/.test(nv)) findings.push(`${name}:${index + 1}:floating-node-version:${nv}`);
    });
  } catch (error) {
    findings.push(`${name}:workflow-policy-parser-error:${error.message}`);
  }
}

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (lock.lockfileVersion !== 3) findings.push(`lockfileVersion:${lock.lockfileVersion}`);
let lockPackages = 0;
let missingIntegrity = 0;
for (const [key, meta] of Object.entries(lock.packages || {})) {
  if (!key.includes('node_modules/') || !meta?.version) continue;
  lockPackages += 1;
  if (!meta.integrity) missingIntegrity += 1;
}
if (missingIntegrity) findings.push(`lock-packages-without-integrity:${missingIntegrity}`);
const status = findings.length ? 'FAIL' : 'PASS';
console[status === 'PASS' ? 'log' : 'error'](JSON.stringify({
  status,
  schema: 'ghrab-github-workflow-supply-chain-v2',
  workflowFiles,
  workflowUses: usesCount,
  lockPackages,
  missingIntegrity,
  guarantees: ['explicit-top-level-read-only', 'write-only-in-deploy', 'no-pull_request_target', 'no-remote-execution-patterns', 'sha-pinned-actions', 'fixed-runner-and-node'],
  findings,
}, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
