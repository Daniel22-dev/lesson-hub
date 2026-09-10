import { icon } from '../ui/icons.js';
import { escapeHtml } from '../core/html.js';

export function statusPill(label, variant = 'neutral', iconName = '') {
  return `<span class="status-pill status-pill--${variant}">${iconName ? icon(iconName, 15) : ''}${escapeHtml(label)}</span>`;
}

export function emptyState({ iconName = 'more', title, text, action = '' }) {
  return `
    <section class="empty-state">
      <div class="empty-state__icon">${icon(iconName, 28)}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      ${action}
    </section>`;
}

export function sectionHeader(title, subtitle = '', action = '') {
  return `
    <div class="section-heading">
      <div>
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${action}
    </div>`;
}

export function formError(message = '') {
  return `<p class="form-error" data-form-error ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>`;
}
