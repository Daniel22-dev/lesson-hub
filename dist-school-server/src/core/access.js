import { APP_CONFIG } from './config.js';
import { escapeAttribute, escapeHtml } from './html.js';

const ACCESS_KEY = 'ghrab.access.permit.v2';

export function getAccessPermit() {
  const permit = window.__GHRAB_STUDIO_ACCESS__?.permit;
  return permit && typeof permit === 'object' ? permit : null;
}

export function getAccessProfile() {
  const permit = getAccessPermit();
  if (!permit) {
    return { userId: 'unknown', displayName: 'Uživatel AI Studia', role: 'trainedTeacher', apps: [] };
  }
  return {
    userId: String(permit.sub || permit.userId || permit.jti || 'unknown'),
    displayName: String(permit.displayName || permit.name || permit.sub || 'Uživatel AI Studia'),
    role: String(permit.role || 'trainedTeacher'),
    apps: Array.isArray(permit.apps) ? [...permit.apps] : [],
    expiresAt: permit.exp || null,
    localDevelopment: Boolean(permit.localDevelopment),
  };
}

export function isAdmin() {
  return getAccessProfile().role === 'admin';
}

export function accessInitials() {
  const name = getAccessProfile().displayName.trim();
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'AI';
}

export function revokeLocalPermit() {
  try {
    localStorage.removeItem(ACCESS_KEY);
  } catch (error) {
    console.warn('Přístupový permit se nepodařilo odstranit.', error);
  }
  location.href = APP_CONFIG.accessUrl;
}


export function openAccessDialog() {
  document.querySelector('#access-account-dialog')?.remove();
  const profile = getAccessProfile();
  const expires = profile.expiresAt
    ? new Date(Number(profile.expiresAt) * 1000).toLocaleString('cs-CZ')
    : 'neuvedena';
  const backdrop = document.createElement('div');
  backdrop.id = 'access-account-dialog';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = /* qa-safe-html: all profile values and URLs are escaped */ `
    <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="access-dialog-title">
      <div class="modal-card__header">
        <div><span class="topbar__eyebrow">Centrální přístup</span><h2 id="access-dialog-title">AI Studio GHRAB</h2></div>
        <button class="icon-button" type="button" data-close-access aria-label="Zavřít">×</button>
      </div>
      <div class="modal-card__body">
        <div class="access-profile-card">
          <strong>${escapeHtml(profile.displayName)}</strong>
          <span>Role: ${escapeHtml(profile.role)}</span>
          <span>ID: ${escapeHtml(profile.userId)}</span>
          <span>Platnost do: ${escapeHtml(expires)}</span>
        </div>
        <p>Přístup byl ověřen centrální branou AI Studia. Lesson Hub neukládá přístupové klíče do svého datového úložiště.</p>
        ${profile.localDevelopment ? '<p class="notice notice--warning">Aktivní je pouze lokální vývojový režim na localhostu.</p>' : ''}
      </div>
      <div class="modal-card__actions">
        <a class="button button--secondary" href="${escapeAttribute(APP_CONFIG.aiStudioUrl)}">Otevřít AI Studio</a>
        <button class="button button--ghost" type="button" data-revoke-access>Odebrat přístup z tohoto zařízení</button>
      </div>
    </section>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-close-access]')) close();
    if (event.target.closest('[data-revoke-access]')) revokeLocalPermit();
  });
  backdrop.querySelector('[data-close-access]')?.focus();
}
