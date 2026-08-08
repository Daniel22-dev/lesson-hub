import { createDatabase } from './core/database.js';
import { createRepositories } from './repositories/repositoryFactory.js';
import { AcademicService } from './services/academicService.js';
import { LessonService } from './services/lessonService.js';
import { WorkService } from './services/workService.js';
import { MaterialService } from './services/materialService.js';
import { SearchService } from './services/searchService.js';
import { BackupService } from './services/backupService.js';
import { TemplateCycleService } from './services/templateCycleService.js';
import { SyncService } from './services/syncService.js';
import { ServerService } from './services/serverService.js';
import { CommunicationService } from './services/communicationService.js';
import { SubstitutionService } from './services/substitutionService.js';
import { appState } from './core/appState.js';
import { APP_EVENTS } from './core/constants.js';
import { eventBus } from './core/eventBus.js';
import { parseCurrentRoute, startRouter } from './ui/router.js';
import { renderLayout, bindLayoutEvents } from './ui/layout.js';
import { showToast } from './ui/toast.js';
import { getPage } from './pages/index.js';
import { registerPwa } from './core/pwa.js';
import { consumeStudioHandoff } from './core/studioBridge.js';
import { escapeHtml } from './core/html.js';

const app = document.querySelector('#app');
let renderSequence = 0;

document.documentElement.dataset.theme = appState.settings.theme;
document.documentElement.dataset.density = appState.settings.density;

window.addEventListener('lesson-hub-database-versionchange', () => {
  showToast('Databáze byla aktualizována v jiné kartě. Uložte rozpracovanou práci a načtěte aplikaci znovu.', 'warning');
});

function renderFatalError(error) {
  document.body.style.visibility = 'visible';
  app.innerHTML = `
    <main class="fatal-error">
      <img class="fatal-error__logo" src="./assets/brand/school-logo.png" alt="Logo Gymnázia, Ostrava-Hrabůvka" />
      <h1>Lesson Hub se nepodařilo spustit</h1>
      <p>${escapeHtml(error?.code === 'database_blocked' ? 'Aktualizaci databáze blokuje jiná otevřená karta. Zavřete ostatní karty Lesson Hubu a zkuste to znovu.' : error.message)}</p>
      <button type="button" onclick="location.reload()">Zkusit znovu</button>
    </main>`;
}

function bindCommonPageActions() {
  document.querySelectorAll('[data-action="wave-placeholder"]').forEach((button) => {
    button.addEventListener('click', () => showToast('Tato funkce je připravena pro následující implementační vlnu.', 'info'));
  });
}

async function renderRoute(context = parseCurrentRoute()) {
  const currentSequence = ++renderSequence;
  const page = getPage(context.route);
  const routeKey = context.raw || context.route;
  app.dataset.pendingRoute = routeKey;
  app.setAttribute('aria-busy', 'true');
  try {
    const model = await page.render(context);
    if (currentSequence !== renderSequence) return;
    app.innerHTML = renderLayout({ activeRoute: context.route, ...model });
    bindLayoutEvents();
    bindCommonPageActions();
    await page.bind?.(context);
    document.querySelector('#page-content')?.focus({ preventScroll: true });
  } catch (error) {
    if (currentSequence !== renderSequence) return;
    console.error(error);
    showToast(error.message || 'Stránku se nepodařilo načíst.', 'error');
    app.innerHTML = renderLayout({
      activeRoute: context.route,
      title: 'Nastala chyba',
      description: 'Tuto část se nepodařilo bezpečně načíst.',
      content: `<section class="content-card"><div class="empty-state"><h2>Obsah není dostupný</h2><p>${escapeHtml(error.message)}</p><button class="button button--secondary" type="button" onclick="location.reload()">Načíst znovu</button></div></section>`,
    });
    bindLayoutEvents();
  } finally {
    // A stale asynchronous render must never mark a newer render as finished.
    if (currentSequence === renderSequence) {
      app.dataset.renderedRoute = routeKey;
      app.dataset.renderSequence = String(currentSequence);
      delete app.dataset.pendingRoute;
      app.removeAttribute('aria-busy');
    }
  }
}

async function bootstrap() {
  try {
    const database = await createDatabase();
    const repositories = createRepositories(database);
    const academicService = new AcademicService(repositories);
    const lessonService = new LessonService(repositories);
    const workService = new WorkService(repositories);
    const materialService = new MaterialService(repositories);
    const searchService = new SearchService(repositories, materialService);
    const backupService = new BackupService(database, repositories);
    const templateCycleService = new TemplateCycleService(repositories, lessonService);
    const serverService = new ServerService();
    const syncService = new SyncService(repositories, serverService);
    const communicationService = new CommunicationService(repositories, serverService);
    const substitutionService = new SubstitutionService(repositories, serverService, lessonService);
    appState.setDatabase(database, repositories, academicService, lessonService, workService, materialService, searchService, backupService, templateCycleService, syncService, serverService, communicationService, substitutionService);
    if (serverService.schoolProfile || serverService.session?.token) {
      try { appState.serverSession = await serverService.restoreSession(); } catch (error) { console.warn('Serverovou relaci se nepodařilo obnovit.', error); }
    }
    await appState.refreshAcademic({ emit: false });

    const imported = await consumeStudioHandoff(repositories);
    if (imported) appState.setStudioImport(imported);

    startRouter(renderRoute);

    eventBus.on(APP_EVENTS.themeChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.academicChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.lessonChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.workChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.materialChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.dataChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.templateChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.cycleChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.syncChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.serverChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.communicationChanged, () => void renderRoute());
    eventBus.on(APP_EVENTS.substitutionChanged, () => void renderRoute());

    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.location.hash = '#/search';
      }
    });

    if (imported) showToast(`Materiál „${imported.stored.title}“ byl bezpečně převzat z AI Studia.`, 'success');

    const pwaStatus = await registerPwa();
    appState.setPwaStatus(pwaStatus);
    document.documentElement.dataset.ghrabAccess = 'granted';
    document.body.style.visibility = 'visible';
  } catch (error) {
    appState.setError(error);
    renderFatalError(error);
  }
}

bootstrap();
