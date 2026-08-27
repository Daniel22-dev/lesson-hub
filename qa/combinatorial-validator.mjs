import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function validateScenario(scenario, { root }) {
  const bootstrap = await readFile(path.join(root, 'src', 'bootstrap.js'), 'utf8');
  const database = await readFile(path.join(root, 'src', 'core', 'database.js'), 'utf8');
  const layout = await readFile(path.join(root, 'src', 'ui', 'layout.js'), 'utf8');
  const qaOnlyLocalAccess = /function isTrustedLocalOrigin\(\)/.test(bootstrap)
    && /localhost/.test(bootstrap)
    && /127\.0\.0\.1/.test(bootstrap)
    && /navigator\.webdriver\s*===\s*true/.test(bootstrap)
    && /get\(['"]qa['"]\)\s*===\s*['"]1['"]/.test(bootstrap)
    && /return isTrustedLocalOrigin\(\) && navigator\.webdriver/.test(bootstrap)
    && /protectApp\(APP_ID/.test(bootstrap);
  const failClosed = /showBootstrapFailure/.test(bootstrap) && !/catch[\s\S]{0,300}import\(['"]\.\/main\.js/.test(bootstrap);
  const storageReady = scenario.storage === 'memory' ? /class MemoryDatabase/.test(database) : /class IndexedDbDatabase/.test(database);
  const roleReady = scenario.role === 'admin' ? /isAdmin\(\)/.test(layout) : /getAccessProfile/.test(layout);
  const permitReady = scenario.permit === 'valid' ? qaOnlyLocalAccess : failClosed;
  return {
    pass: qaOnlyLocalAccess && failClosed && storageReady && roleReady && permitReady,
    evidence: `role=${scenario.role}; permit=${scenario.permit}; storage=${scenario.storage}; qaOnlyLocalAccess=${qaOnlyLocalAccess}; failClosed=${failClosed}`,
  };
}
