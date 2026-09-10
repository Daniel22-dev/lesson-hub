function showUpdateBanner(registration) {
  if (document.querySelector('[data-pwa-update]')) return;
  const banner = document.createElement('div');
  banner.className = 'pwa-update-banner';
  banner.dataset.pwaUpdate = 'true';
  const text = document.createElement('span');
  text.textContent = 'Je dostupná nová verze Lesson Hubu.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--primary';
  button.textContent = 'Načíst novou verzi';
  button.addEventListener('click', () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }));
  banner.append(text, button);
  document.body.append(banner);
}

export async function registerPwa() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return { status: 'unsupported' };
  try {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(registration);
      });
    });
    registration.update().catch(() => {});
    return { status: 'registered', scope: registration.scope };
  } catch (error) {
    console.warn('Registrace PWA selhala.', error);
    return { status: 'failed', message: error.message };
  }
}
