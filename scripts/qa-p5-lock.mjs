#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] || '.');
const pkg = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(rootDir, 'package-lock.json'), 'utf8'));
const failures = [];
if (lock.lockfileVersion !== 3) failures.push(`lockfileVersion=${lock.lockfileVersion}`);
const packages = lock.packages || {};
const root = packages[''] || {};

function parentPackagePath(lockPath) {
  const marker = '/node_modules/';
  const i = lockPath.lastIndexOf(marker);
  return i >= 0 ? lockPath.slice(0, i) : '';
}
function resolveDependency(fromLockPath, name) {
  let current = fromLockPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!current) return null;
    current = parentPackagePath(current);
  }
}
function declared(meta) {
  return { ...(meta?.dependencies || {}), ...(meta?.optionalDependencies || {}), ...(meta?.peerDependencies || {}) };
}
function directGroups(meta) {
  return {
    dependencies: meta?.dependencies || {},
    devDependencies: meta?.devDependencies || {},
    optionalDependencies: meta?.optionalDependencies || {},
  };
}
function packageNameFromLockPath(lockPath) {
  const match = String(lockPath).match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match?.[1] || null;
}
function expectedRegistryPath(name, version) {
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return `/${name}/-/${base}-${version}.tgz`;
}

if (root.name && root.name !== pkg.name) failures.push(`root name ${root.name} != package.json ${pkg.name}`);
if (root.version && root.version !== pkg.version) failures.push(`root version ${root.version} != package.json ${pkg.version}`);

const packageGroups = directGroups(pkg);
const lockGroups = directGroups(root);
for (const group of Object.keys(packageGroups)) {
  const pkgDeps = packageGroups[group];
  const lockedRoot = lockGroups[group];
  for (const [name, spec] of Object.entries(pkgDeps)) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec)) failures.push(`${group}.${name} is not exactly pinned: ${spec}`);
    if (lockedRoot[name] !== spec) failures.push(`${group}.${name} differs from root lock`);
    const entryPath = resolveDependency('', name);
    const entry = entryPath && packages[entryPath];
    if (!entry) failures.push(`missing reachable direct package ${name}`);
    else if (entry.version !== spec) failures.push(`${name}: lock ${entry.version} != ${spec}`);
  }
  for (const [name, spec] of Object.entries(lockedRoot)) {
    if (!Object.prototype.hasOwnProperty.call(pkgDeps, name)) failures.push(`root-lock-only ${group}.${name}=${spec}`);
  }
}

const reachable = new Set();
const directNames = new Set(Object.values(packageGroups).flatMap((group) => Object.keys(group)));
const queue = [...directNames].map((name) => resolveDependency('', name)).filter(Boolean);
while (queue.length) {
  const lockPath = queue.pop();
  if (reachable.has(lockPath)) continue;
  reachable.add(lockPath);
  const meta = packages[lockPath] || {};
  for (const name of Object.keys(declared(meta))) {
    const depPath = resolveDependency(lockPath, name);
    if (!depPath) {
      if (!(meta.peerDependenciesMeta?.[name]?.optional)) failures.push(`${lockPath}: dependency ${name} is not reachable in lockfile`);
    } else queue.push(depPath);
  }
}

for (const [lockPath, entry] of Object.entries(packages)) {
  if (!lockPath || !lockPath.includes('node_modules/')) continue;
  if (!reachable.has(lockPath)) failures.push(`unreachable/extraneous lock entry: ${lockPath}`);
  if (!entry?.version) { failures.push(`${lockPath}: missing version`); continue; }
  if (!entry?.resolved) { failures.push(`${lockPath}: missing resolved`); continue; }
  if (!entry.integrity) failures.push(`${lockPath}: missing integrity`);
  else if (!String(entry.integrity).startsWith('sha512-')) failures.push(`${lockPath}: integrity must use sha512`);
  try {
    const url = new URL(entry.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') failures.push(`${lockPath}: untrusted resolved ${entry.resolved}`);
    if (url.username || url.password) failures.push(`${lockPath}: resolved URL must not contain userinfo`);
    if (url.port) failures.push(`${lockPath}: resolved URL must use canonical HTTPS port 443`);
    if (url.search) failures.push(`${lockPath}: resolved URL must not contain query parameters`);
    if (url.hash) failures.push(`${lockPath}: resolved URL must not contain fragment`);
    if (/%[0-9a-f]{2}/i.test(url.pathname)) failures.push(`${lockPath}: resolved package path must not use percent-encoding`);
    const name = packageNameFromLockPath(lockPath);
    if (!name) failures.push(`${lockPath}: cannot derive package name`);
    else {
      const pathname = decodeURIComponent(url.pathname);
      const expected = expectedRegistryPath(name, entry.version);
      if (pathname !== expected) failures.push(`${lockPath}: resolved path ${pathname} != expected ${expected}`);
    }
  } catch {
    failures.push(`${lockPath}: resolved is not a valid URL`);
  }
}
const serialized = JSON.stringify(lock);
if (serialized.includes('applied-caas-gateway') || serialized.includes('.internal.api.openai.org')) failures.push('lockfile contains internal registry');

const out = {
  schema: 'ghrab-p5-lock-audit-v3',
  status: failures.length ? 'failed' : 'passed',
  package: pkg.name,
  version: pkg.version,
  directDependencies: directNames.size,
  lockedPackages: Object.keys(packages).filter((key) => key.includes('node_modules/')).length,
  reachablePackages: reachable.size,
  registry: 'https://registry.npmjs.org',
  guarantees: ['root-lock-equals-package-json', 'full-registry-package-path', 'no-userinfo-port-query-fragment-or-percent-encoding', 'sha512-integrity', 'no-extraneous-lock-entries'],
  failures,
};
console[failures.length ? 'error' : 'log'](JSON.stringify(out, null, 2));
process.exit(failures.length ? 1 : 0);
