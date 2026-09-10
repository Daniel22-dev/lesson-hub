import { APP_EVENTS } from './constants.js';
import { eventBus } from './eventBus.js';
import { loadSettings, saveSettings } from './settings.js';
import { showToast } from '../ui/toast.js';

class AppState {
  constructor() {
    this.settings = loadSettings();
    this.database = null;
    this.repositories = null;
    this.academicService = null;
    this.lessonService = null;
    this.workService = null;
    this.materialService = null;
    this.searchService = null;
    this.backupService = null;
    this.templateCycleService = null;
    this.syncService = null;
    this.serverService = null;
    this.communicationService = null;
    this.substitutionService = null;
    this.serverSession = null;
    this.academic = { years: [], subjects: [], currentYear: null, activeGroupCount: 0, hiddenGroupCount: 0, archivedGroupCount: 0 };
    this.isReady = false;
    this.lastError = null;
    this.studioImport = null;
    this.pwaStatus = null;
  }

  setDatabase(database, repositories, academicService, lessonService, workService, materialService, searchService, backupService, templateCycleService, syncService, serverService = null, communicationService = null, substitutionService = null) {
    this.database = database;
    this.repositories = repositories;
    this.academicService = academicService;
    this.lessonService = lessonService;
    this.workService = workService;
    this.materialService = materialService;
    this.searchService = searchService;
    this.backupService = backupService;
    this.templateCycleService = templateCycleService;
    this.syncService = syncService;
    this.serverService = serverService;
    this.communicationService = communicationService;
    this.substitutionService = substitutionService;
    this.serverSession = serverService?.profile || null;
    this.isReady = true;
    eventBus.emit(APP_EVENTS.databaseReady, { storageKind: database.kind });
  }

  async refreshAcademic({ emit = true } = {}) {
    if (!this.academicService) return this.academic;
    this.academic = await this.academicService.snapshot();
    if (emit) eventBus.emit(APP_EVENTS.academicChanged, this.academic);
    return this.academic;
  }


  setServerSession(profile) {
    this.serverSession = profile || null;
    eventBus.emit(APP_EVENTS.serverChanged, { profile: this.serverSession });
  }

  setStudioImport(studioImport) {
    this.studioImport = studioImport;
  }

  setPwaStatus(pwaStatus) {
    this.pwaStatus = pwaStatus;
  }

  setError(error) {
    this.lastError = error;
    eventBus.emit(APP_EVENTS.databaseError, { message: error.message });
  }

  clearForSuiteEnd() {
    try { this.serverService?.clearSession?.(); } catch {}
    this.serverSession = null;
    this.studioImport = null;
    this.academic = { years: [], subjects: [], currentYear: null, activeGroupCount: 0, hiddenGroupCount: 0, archivedGroupCount: 0 };
    this.lastError = null;
    this.isReady = false;
  }

  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    const persisted = saveSettings(this.settings);
    if (!persisted.ok) showToast('Nastavení se změnilo pouze pro tuto relaci; úložiště prohlížeče je nedostupné.', 'warning');
    document.documentElement.dataset.theme = this.settings.theme;
    document.documentElement.dataset.density = this.settings.density;
    eventBus.emit(APP_EVENTS.themeChanged, this.settings);
  }
}

export const appState = new AppState();
