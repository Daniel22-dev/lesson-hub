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
  aiStudioUrl: 'https://daniel22-dev.github.io/AI-Studio-GHRAB/',
  accessUrl: 'https://daniel22-dev.github.io/AI-Studio-GHRAB/access/',
  accessGuardUrl: 'https://daniel22-dev.github.io/AI-Studio-GHRAB/access/app-guard.js',
  schoolLogoUrl: './src/assets/brand/school-logo.jpg',
  manualUrl: './manual/',
  supportEmail: '',
  storageWarning:
    'Tato verze ukládá data lokálně v tomto prohlížeči. Pravidelně používejte export a ukládejte zálohu mimo zařízení.',
});
