import { ROUTES, APP_EVENTS } from '../core/constants.js';
import { eventBus } from '../core/eventBus.js';

const VALID_ROUTES = new Set(Object.values(ROUTES));

export function parseCurrentRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '') || ROUTES.overview;
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const route = VALID_ROUTES.has(segments[0]) ? segments[0] : ROUTES.overview;
  return {
    route,
    segments: [route, ...segments.slice(1)],
    params: segments.slice(1),
    query: new URLSearchParams(queryPart),
    raw,
  };
}

export function navigate(route, params = [], query = {}) {
  const safeRoute = VALID_ROUTES.has(route) ? route : ROUTES.overview;
  const path = [safeRoute, ...params.filter(Boolean)].join('/');
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== '' && value != null));
  const nextHash = `#/${path}${search.size ? `?${search}` : ''}`;
  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = nextHash;
  }
}

export function startRouter(onRouteChange) {
  const handle = async () => {
    const context = parseCurrentRoute();
    await onRouteChange(context);
    eventBus.emit(APP_EVENTS.routeChanged, context);
  };

  window.addEventListener('hashchange', handle);
  if (!window.location.hash) {
    window.location.hash = `#/${ROUTES.overview}`;
  } else {
    void handle();
  }

  return () => window.removeEventListener('hashchange', handle);
}
