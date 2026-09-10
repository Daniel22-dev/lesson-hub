import { createId } from './schema.js';
import { recordAnonymousOutput } from './telemetry.js';

const HANDOFF_KEY = 'ghrab.handoff.v1';
const MAX_HANDOFF_BYTES = 500_000;

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    console.warn(`Studio Bridge: čtení ${key} selhalo.`, error);
    return fallback;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Studio Bridge: odstranění ${key} selhalo.`, error);
  }
}

function validMaterial(material) {
  return Boolean(
    material &&
    material.schema === 'ghrab-material-v1' &&
    typeof material.id === 'string' && material.id.trim() &&
    typeof material.title === 'string' && material.title.trim() &&
    typeof material.subject === 'string' && material.subject.trim() &&
    material.content && typeof material.content === 'object' &&
    JSON.stringify(material).length <= MAX_HANDOFF_BYTES
  );
}

function readHandoff() {
  const query = new URLSearchParams(location.search);
  if (query.get('studioHandoff') !== '1') return null;
  const platformPayload = globalThis.GHRAB_PLATFORM?.bridge?.take?.({ target: 'lesson-hub', maxBytes: MAX_HANDOFF_BYTES });
  if (platformPayload) return platformPayload;
  const payload = readJson(HANDOFF_KEY, null);
  if (!payload || payload.schema !== 'ghrab-handoff-v1' || payload.target !== 'lesson-hub') return null;
  if (!validMaterial(payload.material)) return null;
  const expiry = Date.parse(payload.expiresAt || '');
  if (!Number.isFinite(expiry) || expiry < Date.now()) {
    remove(HANDOFF_KEY);
    return null;
  }
  return payload;
}


export async function consumeStudioHandoff(repositories) {
  const payload = readHandoff();
  if (!payload) return null;
  const material = payload.material;
  const existing = (await repositories.materials.list()).find(
    (item) => item.sourceMaterialId === material.id && item.sourceSchema === material.schema,
  );
  const data = {
    title: material.title,
    description: material.description || '',
    materialType: ['worksheet', 'solution', 'test', 'presentation', 'document', 'image', 'audio', 'video', 'app', 'note', 'link'].includes(material.type) ? material.type : 'other',
    sourceType: 'studio',
    sourceSchema: material.schema,
    sourceMaterialId: material.id,
    subject: material.subject,
    language: material.language || '',
    level: material.level || '',
    yearGroup: material.yearGroup || '',
    objectives: Array.isArray(material.objectives) ? material.objectives : [],
    content: material.content,
    teacherNote: 'Převzato prostřednictvím Studio Bridge 2.0.',
    studentFacing: false,
    visibility: 'private',
    status: 'active',
    normalizedKey: `studio:${material.schema}:${material.id}`,
    importedAt: new Date().toISOString(),
  };
  const stored = existing
    ? await repositories.materials.update(existing.id, data)
    : await repositories.materials.create({ id: createId('studioMaterial'), ...data });
  remove(HANDOFF_KEY);
  recordAnonymousOutput('material-import');
  return { stored, payload };
}
