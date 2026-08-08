import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/core/database.js';
import { createRepositories } from '../src/repositories/repositoryFactory.js';
import { SyncService } from '../src/services/syncService.js';
import { BackupService, sha256Fallback } from '../src/services/backupService.js';
import { findUnsafeHtmlAssignments } from './qa-security-utils.mjs';
import { ENTITY_STORES } from '../src/core/constants.js';
import { BaseRepository } from '../src/repositories/BaseRepository.js';
import { setLocalDocument } from './qa-core.mjs';


const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let qaDocumentUrl = '';
const qaPageProbe = {
  async addInitScript() {},
  async goto(url) { qaDocumentUrl = url; },
};
const qaDocumentTarget = await setLocalDocument(qaPageProbe, projectRoot, '/index.html#/groups', 'http://127.0.0.1:4173');
assert.equal(qaDocumentTarget.endsWith('/index.html'), true, 'Hashová trasa nesmí být součástí cesty k souboru.');
assert.equal(qaDocumentUrl.endsWith('/index.html#/groups'), true, 'Hashová trasa musí zůstat zachována v lokální HTTP adrese.');
await assert.rejects(
  () => setLocalDocument(qaPageProbe, projectRoot, '/../outside.html#/overview', 'http://127.0.0.1:4173'),
  /escapes serve root/,
);
const visualReporterSource = await readFile(new URL('./qa-visual-playwright.mjs', import.meta.url), 'utf8');
assert.equal(visualReporterSource.includes('item.message || item.summary || "Nález bez popisu"'), true, 'Vizuální reportér musí vždy vypsat skutečnou zprávu nebo bezpečný fallback.');
assert.equal(visualReporterSource.includes(': ${item.summary}`'), false, 'Vizuální reportér nesmí používat samotné neexistující pole summary.');
assert.equal(visualReporterSource.includes('rect.top < vh'), false, 'Povinný prvek níže pod prvním svislým viewportem nesmí být označen jako skrytý.');
assert.equal(visualReporterSource.includes('rect.left < vw'), true, 'Vizuální brána musí nadále hlídat vodorovné umístění povinných prvků.');
assert.equal(visualReporterSource.includes('async function executeEvaluateStep'), true, 'Vizuální brána musí funkční evaluate kroky skutečně vykonat.');
assert.equal(visualReporterSource.includes('await page.evaluate(step.script)'), false, 'Vizuální brána nesmí pouze vrátit funkční výraz bez zavolání.');
const headlessRunnerSource = await readFile(new URL('../tools/headless-check.mjs', import.meta.url), 'utf8');
assert.equal(headlessRunnerSource.includes('async function waitForMainApp'), true, 'Headless smoke test musí počkat na dokončený render trasy.');
assert.equal(headlessRunnerSource.includes('qa=1'), true, 'Headless smoke test musí lokální QA přístup zapnout explicitním parametrem.');
assert.equal(headlessRunnerSource.includes('app.dataset.renderedRoute === routeKey'), true, 'Headless smoke test musí ověřovat správně dokončenou hash trasu.');
const criticalRunnerSource = await readFile(new URL('./qa-critical-playwright.mjs', import.meta.url), 'utf8');
const criticalFlowsSource = await readFile(new URL('../qa/critical-flows.json', import.meta.url), 'utf8');
assert.equal(criticalRunnerSource.includes('async function waitForAppReady'), true, 'Kritická brána musí čekat na dokončení asynchronního vykreslení aplikace.');
assert.equal(criticalRunnerSource.includes('async function executeEvaluateStep'), true, 'Kritická brána musí mít explicitní vykonání důvěryhodných evaluate kroků.');
assert.equal(criticalRunnerSource.includes('typeof candidate === "function" ? await candidate() : candidate'), true, 'Funkční evaluate krok se musí skutečně zavolat, ne pouze vrátit jako objekt.');
assert.equal(criticalRunnerSource.includes('await page.evaluate(step.script)'), false, 'Kritická brána nesmí znovu pouze vyhodnotit funkční výraz bez zavolání.');
assert.equal(criticalRunnerSource.includes("value !== '__TODAY__'"), true, 'Kritická brána musí podporovat dynamické dnešní datum.');
assert.equal(criticalFlowsSource.includes('2026-07-30'), false, 'Kritické scénáře nesmí používat prošlé pevné datum dnešní výuky.');
assert.equal((criticalFlowsSource.match(/__TODAY__/g) || []).length, 3, 'Tři scénáře výuky musí používat dynamické dnešní datum.');
const pythonBrowserCommonSource = await readFile(new URL('../tools/qa_browser_common.py', import.meta.url), 'utf8');
assert.equal(pythonBrowserCommonSource.includes('async def wait_for_app_idle'), true, 'Python fallback musí stejně jako Node runner čekat na vykreslení aplikace.');
assert.equal(pythonBrowserCommonSource.includes('async def execute_evaluate_step'), true, 'Python fallback musí funkční evaluate kroky skutečně vykonat.');
assert.equal(pythonBrowserCommonSource.includes("typeof candidate === 'function' ? await candidate() : candidate"), true, 'Python fallback nesmí vracet funkční výraz bez zavolání.');
assert.equal(pythonBrowserCommonSource.includes("value != '__TODAY__'"), true, 'Python fallback musí podporovat dynamické dnešní datum.');

if (!globalThis.localStorage) {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

assert.equal(sha256Fallback(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.equal(sha256Fallback('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const unsafeHtmlSample = Buffer.from('cmVnaW9uLmlubmVySFRNTCA9IGA8ZGl2PiR7bWVzc2FnZX08L2Rpdj5gOw==', 'base64').toString('utf8');
const safeHtmlSample = Buffer.from('cmVnaW9uLmlubmVySFRNTCA9IGA8ZGl2PiR7ZXNjYXBlSHRtbChtZXNzYWdlKX08L2Rpdj5gOw==', 'base64').toString('utf8');
const unsafeRenderSample = 'function renderX(){ return `<span>${value}</span>`; }';
const safeRenderSample = 'function renderX(){ return `<span>${escapeHtml(value)}</span>`; }';
assert.equal(findUnsafeHtmlAssignments(unsafeHtmlSample).length, 1);
assert.equal(findUnsafeHtmlAssignments(safeHtmlSample).length, 0);
assert.equal(findUnsafeHtmlAssignments(unsafeRenderSample, { scanRenderFunctions: true }).length, 1);
assert.equal(findUnsafeHtmlAssignments(safeRenderSample, { scanRenderFunctions: true }).length, 0);
const currentLayoutSource = await readFile(new URL('../src/ui/layout.js', import.meta.url), 'utf8');
assert.equal(findUnsafeHtmlAssignments(currentLayoutSource, { scanRenderFunctions: true }).length, 0);
const regressedLayoutSource = currentLayoutSource.replace('escapeHtml(profile.displayName)', 'profile.displayName');
assert.equal(findUnsafeHtmlAssignments(regressedLayoutSource, { scanRenderFunctions: true }).length > 0, true, 'Bezpečnostní brána musí zachytit návrat neescapovaného displayName v renderLayout.');

let pruneCountCalls = 0;
let pruneGetAllCalls = 0;
const auditDatabaseProbe = {
  async put() {},
  async count() { pruneCountCalls += 1; return 5000; },
  async getAll() { pruneGetAllCalls += 1; return []; },
  async delete() {},
};
const auditRepositoryProbe = new BaseRepository(auditDatabaseProbe, 'auditEvents', 'audit');
for (let index = 0; index < 100; index += 1) await auditRepositoryProbe.create({ action: 'probe', timestamp: new Date().toISOString() });
assert.equal(pruneCountCalls, 1, 'Ořez auditu se má kontrolovat amortizovaně po 100 zápisech.');
assert.equal(pruneGetAllCalls, 0, 'Při méně než 5 500 záznamech se nesmí načítat a třídit celý audit.');

const database = await createDatabase();
const repositories = createRepositories(database);
await repositories.lessons.create({ id: 'local_failed', title: 'Lokální', updatedAt: '2026-01-01T00:00:00.000Z' });
await repositories.syncQueue.create({ id: 'failed_queue', auditEventId: 'audit_failed', resource: 'lessons', entityId: 'local_failed', operation: 'upsert', payload: { id: 'local_failed', title: 'Lokální' }, status: 'failed', attemptCount: 1 });
let pullPage = 0;
const fakeServer = {
  isAuthenticated: true,
  config: { lastCursor: 0 },
  setCursor(value) { this.config.lastCursor = value; },
  async pull() {
    pullPage += 1;
    if (pullPage === 1) return { items: [{ resource: 'lessons', entityId: 'remote_1', operation: 'upsert', payload: { id: 'remote_1', title: 'R1', updatedAt: '2026-01-01T00:00:00.000Z' }, cursor: 1 }, { resource: 'lessons', entityId: 'local_failed', operation: 'upsert', payload: { id: 'local_failed', title: 'Server', updatedAt: '2026-01-02T00:00:00.000Z' }, cursor: 2 }], cursor: 2, hasMore: true };
    return { items: [{ resource: 'lessons', entityId: 'remote_2', operation: 'upsert', payload: { id: 'remote_2', title: 'R2', updatedAt: '2026-01-03T00:00:00.000Z' }, cursor: 3 }], cursor: 3, hasMore: false };
  },
  async push() { throw new Error('Dočasná chyba'); },
  async listResource(resource) { return resource === 'lessons' ? [{ id: 'full_1', title: 'Full', updatedAt: '2026-02-01T00:00:00.000Z' }] : []; },
  async serverInfo() { return { currentCursor: 50 }; },
};
const sync = new SyncService(repositories, fakeServer);
const pulled = await sync.pullRemote({ limit: 2 });
assert.equal(pulled.pages, 2);
assert.equal(Boolean(await repositories.lessons.get('remote_2')), true);
assert.equal((await repositories.lessons.get('local_failed')).title, 'Lokální');
assert.equal((await sync.conflicts()).length, 1, 'I failed položka musí chránit lokální změnu před přepsáním.');

await repositories.syncQueue.create({ id: 'retry_cap', auditEventId: 'audit_cap', resource: 'lessons', entityId: 'remote_1', operation: 'upsert', payload: { id: 'remote_1' }, status: 'failed', attemptCount: 4 });
await assert.rejects(() => sync.pushPending());
assert.equal((await repositories.syncQueue.get('retry_cap')).status, 'blocked');

fakeServer.pull = async () => { const error = new Error('Old'); error.code = 'cursor_too_old'; throw error; };
const refreshed = await sync.pullRemote();
assert.equal(refreshed.fullRefresh, true);
assert.equal(Boolean(await repositories.lessons.get('full_1')), true);
assert.equal(fakeServer.config.lastCursor, 50);

await database.put(ENTITY_STORES.lessons, { id: 'replace_me', title: 'Old' });
await database.importStores({ schoolYears: [], unknownStore: [{ id: 'x' }] }, { mode: 'replace', replaceStoreNames: [ENTITY_STORES.lessons, ENTITY_STORES.schoolYears] });
assert.equal(await database.get(ENTITY_STORES.lessons, 'replace_me'), undefined);

await repositories.lessons.create({ id: 'restored_lesson', title: 'Obnovená hodina', status: 'completed', updatedAt: '2026-03-01T00:00:00.000Z' });
const backupService = new BackupService(database, repositories);
const restorePackage = await backupService.exportPackage({ label: 'Test obnovy', reason: 'manual' });
await database.clear(ENTITY_STORES.lessons);
const restored = await backupService.importPackage(restorePackage, { mode: 'replace', createSafetyBackup: false });
await sync.prepareFromAudit();
const restoreQueue = await repositories.syncQueue.list();
assert.equal(Boolean(await repositories.lessons.get('restored_lesson')), true);
assert.equal(restored.restoreSyncQueued > 0, true, 'Obnova musí explicitně připravit synchronizační frontu.');
assert.equal(restoreQueue.some((item) => item.entityId === 'restored_lesson' && item.status === 'pending'), true, 'Obnovená hodina musí čekat na odeslání na server.');
assert.equal((await backupService.restoreSyncStatus()).queued, restored.restoreSyncQueued);

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /currentSequence === renderSequence/, 'Starší render nesmí ukončit novější render.');
assert.match(mainSource, /catch \(error\) \{\s*if \(currentSequence !== renderSequence\) return;/, 'Starší chybový render nesmí přepsat novější trasu.');
assert.match(mainSource, /dataset\.renderedRoute/, 'Aplikace musí zveřejnit dokončenou hash trasu pro spolehlivou diagnostiku.');
assert.match(criticalRunnerSource, /dataset\.renderedRoute === expectedRoute/, 'Kritická QA musí čekat na render aktuální hash trasy.');
assert.match(pythonBrowserCommonSource, /dataset\.renderedRoute === expectedRoute/, 'Python fallback musí čekat na render aktuální hash trasy.');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(packageJson.overrides?.['brace-expansion'], '5.0.8', 'Bezpečnostní override brace-expansion musí zůstat připnutý.');
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const braceExpansionVersion = packageLock.packages?.['node_modules/brace-expansion']?.version;
assert.ok(braceExpansionVersion === undefined || braceExpansionVersion === '5.0.8', 'Lockfile nesmí obsahovat zranitelný brace-expansion.');

console.log('Auditní klientské regrese prošly: hashové QA cesty, vykonání evaluate kroků, headless připravenost, čitelný vizuální reportér, trasově stabilní čekání kritických workflow a render race pojistku, dynamická data, XSS detektor včetně render funkcí, amortizace auditu, SHA-256, dávková synchronizace, konflikty, retry limit, full refresh, replace import a synchronizace obnovené zálohy.');
