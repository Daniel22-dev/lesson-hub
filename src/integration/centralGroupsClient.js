import { APP_CONFIG } from '../core/config.js';
import { readCanonicalMetadataOnly } from '../services/canonicalGroupModel.js';

let servicePromise = null;

async function loadService() {
  if (typeof document === 'undefined' || document.documentElement.dataset.ghrabAccess !== 'granted') {
    throw new Error('CENTRAL_ACCESS_DENIED');
  }
  const base = new URL(APP_CONFIG.aiStudioUrl, location.href);
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== location.origin ||
      base.username || base.password || base.search || base.hash) throw new Error('CENTRAL_ORIGIN_DENIED');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const script = new URL('groups/group-service.js', base);
  if (script.origin !== location.origin || !script.pathname.startsWith(base.pathname)) throw new Error('CENTRAL_PATH_DENIED');
  const module = await import(script.href);
  if (typeof module.createGroupsService !== 'function') throw new Error('CENTRAL_SERVICE_UNAVAILABLE');
  const api = module.createGroupsService();
  return api;
}

export async function listCentralGroupMetadata() {
  // Do NOT call getRosterProjection/listGroups/getGroup, or access raw storage.
  if (!servicePromise) servicePromise = loadService().catch((error) => { servicePromise = null; throw error; });
  const service = await servicePromise;
  return readCanonicalMetadataOnly(service);
}

export function resetCentralGroupClientForTests() { servicePromise = null; }