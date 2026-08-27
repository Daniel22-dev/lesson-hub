import { escapeHtml } from '../core/html.js';

let activeModal = null;
let activeCleanup = null;

export function closeModal() {
  activeCleanup?.();
  activeCleanup = null;
  activeModal?.remove();
  activeModal = null;
  document.body.classList.remove('has-modal');
}

export function openModal({ id = 'app-modal', eyebrow = 'Lesson Hub', title, body, actions = '', wide = false, onOpen }) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.id = id;
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = /* qa-safe-html: body/actions are composed by trusted dialog builders and user fields are escaped at source */ `
    <section class="modal-card ${wide ? 'modal-card--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-card__header">
        <div><span class="topbar__eyebrow">${escapeHtml(eyebrow)}</span><h2 id="${id}-title">${escapeHtml(title)}</h2></div>
        <button class="icon-button" type="button" data-close-modal aria-label="Zavřít">×</button>
      </div>
      <div class="modal-card__body">${body}</div>
      ${actions ? `<div class="modal-card__actions">${actions}</div>` : ''}
    </section>`;

  document.body.append(backdrop);
  document.body.classList.add('has-modal');
  activeModal = backdrop;

  const close = () => closeModal();
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-close-modal]')) close();
  });

  const handleKeydown = (event) => {
    if (event.key === 'Escape' && activeModal === backdrop) {
      close();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);
  activeCleanup = () => document.removeEventListener('keydown', handleKeydown);

  onOpen?.(backdrop, close);
  window.setTimeout(() => {
    backdrop.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus();
  }, 0);

  return { element: backdrop, close };
}

export function confirmAction({ title, message, confirmLabel = 'Potvrdit', danger = false, onConfirm }) {
  return openModal({
    id: 'confirm-modal',
    eyebrow: 'Potvrzení',
    title,
    body: `<p class="modal-message">${escapeHtml(message)}</p><p class="form-error" data-confirm-error hidden></p>`,
    actions: `
      <button class="button button--ghost" type="button" data-close-modal>Zrušit</button>
      <button class="button ${danger ? 'button--danger' : 'button--primary'}" type="button" data-confirm-action>${escapeHtml(confirmLabel)}</button>`,
    onOpen(backdrop, close) {
      backdrop.querySelector('[data-confirm-action]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await onConfirm?.();
          close();
        } catch (error) {
          const region = backdrop.querySelector('[data-confirm-error]');
          if (region) { region.hidden = false; region.textContent = error.message || 'Operaci se nepodařilo dokončit.'; }
        } finally {
          button.disabled = false;
        }
      });
    },
  });
}
