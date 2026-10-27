import { APP_CONFIG } from '../core/config.js';
import { readCanonicalMetadataOnly } from '../services/canonicalGroupModel.js';

// v2 client intentionally exposes metadata only. Student names/e-mails never
// enter Lesson Hub. No fallback to the shared v1 browser-origin roster.
let servicePromise = null;

async function loadService() {
  if (typeof document === 'undefined' || document.documentElement.dataset.ghrabAccess !== 'granted') {
    throw new Error('CENTRAL_ACCESS_DENIED');
  }
  const base = new URL(APP_CONFIG.aiStudioUrl, location.href);
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== location.origin ||
      base.username || base.password || base.search || base.hash) throw new Error('CENTRAL_ORIGIN_DENIED');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const script = new URL('groups/verified-client.js', base);
  if (script.origin !== location.origin || !script.pathname.startsWith(base.pathname)) throw new Error('CENTRAL_PATH_DENIED');

  const module = await import(script.href);
  if (typeof module.openVerifiedGroupsV2 !== 'function') throw new Error('CENTRAL_VERIFIED_CLIENT_REQUIRED');
  const verified = await module.openVerifiedGroupsV2('lesson-hub');
  if (document.documentElement.dataset.ghrabAccess !== 'granted') throw new Error('CENTRAL_ACCESS_DENIED');
  if (verified?.schema !== 'ghrab-groups-verified-consumer-v2' ||
      verified.consumerAppId !== 'lesson-hub' ||
      typeof verified.legacyStorePresent !== 'boolean' ||
      verified.service?.schema !== 'ghrab-groups-service-v1' ||
      verified.service.contractVersion !== 1 ||
      typeof verified.service.listGroupMetadata !== 'function') {
    throw new Error('CENTRAL_V2_CONTRACT_INVALID');
  }
  return { service: verified.service, legacyStorePresent: verified.legacyStorePresent };
}

export async function listCentralGroupMetadata() {
  // Do NOT call getRosterProjection/listGroups/getGroup, or access raw storage.
  if (!servicePromise) servicePromise = loadService().catch(error => { servicePromise = null; throw error; });
  const { service, legacyStorePresent } = await servicePromise;
  const list = readCanonicalMetadataOnly(service);
  if (!list.length && legacyStorePresent) throw new Error('CENTRAL_LEGACY_MIGRATION_REQUIRED');
  return list;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('ghrab:access-changed', () => { servicePromise = null; });
}

export function resetCentralGroupClientForTests() { servicePromise = null; }
