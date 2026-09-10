import { isPersistenceBlocked } from './persistenceGuard.js';

export const LESSON_DRAFT_PREFIX = 'lesson-hub.lesson-draft.v1.';

export function lessonDraftKey(lessonId = 'new', groupId = '') {
  return `${LESSON_DRAFT_PREFIX}${lessonId}.${groupId || 'none'}`;
}

export function readLessonDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLessonDraft(key, payload) {
  if (isPersistenceBlocked()) return { ok: false, blocked: true };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return { ok: true, blocked: false };
  } catch (error) {
    return { ok: false, blocked: false, error };
  }
}

export function clearLessonDraft(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
