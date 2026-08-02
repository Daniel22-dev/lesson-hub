const ALLOWED_OUTPUTS = new Set([
  'lesson-plan',
  'lesson-record',
  'material-record',
  'material-import',
  'backup-export',
]);

export function recordAnonymousOutput(outputKind, { attempted = 1, successful = 1, failed = 0, cancelled = 0 } = {}) {
  if (!ALLOWED_OUTPUTS.has(outputKind)) return false;
  const telemetry = globalThis.GHRABTelemetry;
  if (!telemetry || typeof telemetry.recordOutput !== 'function') return false;
  try {
    return telemetry.recordOutput({
      outputKind,
      attemptedQuantity: attempted,
      successfulQuantity: successful,
      failedQuantity: failed,
      cancelledQuantity: cancelled,
    });
  } catch (error) {
    console.warn('Anonymní pilotní metrika se nepodařila uložit.', error);
    return false;
  }
}
