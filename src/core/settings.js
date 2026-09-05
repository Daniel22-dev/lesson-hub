import { isPersistenceBlocked } from './persistenceGuard.js';

const SETTINGS_KEY = 'lesson-hub-ui-settings';

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'light',
  density: 'comfortable',
  sidebarCollapsed: false,
});

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  if (isPersistenceBlocked()) return { ok: false, blocked: true, error: null };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return { ok: true, error: null };
  } catch (error) {
    console.warn('Nastavení vzhledu se nepodařilo uložit.', error);
    return { ok: false, error };
  }
}
