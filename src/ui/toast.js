let timeoutId;
const VARIANTS = new Set(['info', 'success', 'error', 'warning']);

export function showToast(message, variant = 'info') {
  let region = document.querySelector('#toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }

  const safeVariant = VARIANTS.has(variant) ? variant : 'info';
  const box = document.createElement('div');
  box.className = `toast toast--${safeVariant}`;
  box.textContent = String(message || '');
  region.replaceChildren(box);
  clearTimeout(timeoutId);
  timeoutId = window.setTimeout(() => region.replaceChildren(), 3200);
}
