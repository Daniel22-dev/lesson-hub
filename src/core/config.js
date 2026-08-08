import { APP_RELEASE } from './release.js';

export const APP_CONFIG = Object.freeze({
  appId: APP_RELEASE.appId,
  appName: 'Lesson Hub',
  appSubtitle: 'Osobní paměť učitele',
  ecosystemName: 'AI Studio GHRAB',
  version: APP_RELEASE.version,
  releaseStatus: APP_RELEASE.status,
  ownerName: 'Daniel Baláž · Gymnázium, Ostrava-Hrabůvka',
  ownerFooter: 'Vlastník aplikace: Daniel Baláž · Gymnázium, Ostrava-Hrabůvka',
  copyright: '© 2026 Daniel Baláž. Všechna práva vyhrazena.',
  authorName: 'Daniel Baláž',
  schoolName: 'GYMNÁZIUM, OSTRAVA-HRABŮVKA',
  aiStudioUrl: globalThis.__GHRAB_DEPLOYMENT_CONFIG__?.studioBaseUrl || '/AI-Studio-GHRAB/',
  accessUrl: globalThis.__GHRAB_DEPLOYMENT_CONFIG__?.access?.accessPageUrl || '/AI-Studio-GHRAB/access/',
  accessGuardUrl: globalThis.__GHRAB_DEPLOYMENT_CONFIG__?.access?.guardUrl || '/AI-Studio-GHRAB/access/app-guard.js',
  schoolLogoUrl: './src/assets/brand/school-logo.png',
  manualUrl: './manual/',
  supportEmail: '',
  storageWarning:
    'Tato verze ukládá data lokálně v tomto prohlížeči. Pravidelně používejte export a ukládejte zálohu mimo zařízení.',
});
