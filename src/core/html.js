export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function normalizeText(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}
