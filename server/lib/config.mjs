import path from 'node:path';

function integer(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function loadServerConfig(env = process.env) {
  return Object.freeze({
    host: env.LESSON_HUB_SERVER_HOST || '127.0.0.1',
    port: integer(env.LESSON_HUB_SERVER_PORT, 8787, 1, 65535),
    storageDriver: String(env.LESSON_HUB_STORAGE_DRIVER || 'json').trim().toLowerCase(),
    dataFile: path.resolve(env.LESSON_HUB_SERVER_DATA || 'server/data/lesson-hub-server.json'),
    attachmentsDir: path.resolve(env.LESSON_HUB_ATTACHMENTS_DIR || 'server/data/attachments'),
    allowedOrigins: String(env.LESSON_HUB_ALLOWED_ORIGINS || 'http://localhost:4173,http://127.0.0.1:4173')
      .split(',').map((value) => value.trim()).filter(Boolean),
    upstreamAuthSecret: String(env.LESSON_HUB_GHRAB_UPSTREAM_SECRET || '').trim(),
    sessionHours: integer(env.LESSON_HUB_SESSION_HOURS, 12, 1, 168),
    bodyLimitBytes: integer(env.LESSON_HUB_BODY_LIMIT, 12 * 1024 * 1024, 1024, 30 * 1024 * 1024),
    attachmentLimitBytes: integer(env.LESSON_HUB_ATTACHMENT_LIMIT, 8 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    loginWindowMs: integer(env.LESSON_HUB_LOGIN_WINDOW_MS, 10 * 60 * 1000, 60_000, 60 * 60 * 1000),
    loginAttempts: integer(env.LESSON_HUB_LOGIN_ATTEMPTS, 8, 2, 50),
    mailMode: ['disabled', 'file', 'smtp'].includes(String(env.LESSON_HUB_MAIL_MODE || '').toLowerCase()) ? String(env.LESSON_HUB_MAIL_MODE).toLowerCase() : 'disabled',
    mailFrom: String(env.LESSON_HUB_MAIL_FROM || '').trim(),
    mailReplyTo: String(env.LESSON_HUB_MAIL_REPLY_TO || '').trim(),
    mailOutboxDir: path.resolve(env.LESSON_HUB_MAIL_OUTBOX_DIR || 'server/data/outbox'),
    mailSchedulerEnabled: String(env.LESSON_HUB_MAIL_SCHEDULER || 'true').toLowerCase() !== 'false',
    mailSchedulerIntervalMs: integer(env.LESSON_HUB_MAIL_INTERVAL_MS, 60_000, 10_000, 3_600_000),
    mailMaxAttempts: integer(env.LESSON_HUB_MAIL_MAX_ATTEMPTS, 4, 1, 12),
    mailRetryMinutes: integer(env.LESSON_HUB_MAIL_RETRY_MINUTES, 15, 1, 1440),
    smtpHost: String(env.LESSON_HUB_SMTP_HOST || '').trim(),
    smtpPort: integer(env.LESSON_HUB_SMTP_PORT, 587, 1, 65535),
    smtpSecure: String(env.LESSON_HUB_SMTP_SECURE || 'false').toLowerCase() === 'true',
    smtpStartTls: String(env.LESSON_HUB_SMTP_STARTTLS || 'true').toLowerCase() !== 'false',
    smtpRequireTls: String(env.LESSON_HUB_SMTP_REQUIRE_TLS || 'true').toLowerCase() !== 'false',
    smtpUser: String(env.LESSON_HUB_SMTP_USER || '').trim(),
    smtpPassword: String(env.LESSON_HUB_SMTP_PASSWORD || ''),
    smtpHeloName: String(env.LESSON_HUB_SMTP_HELO || 'lesson-hub.local').trim(),
    backupDir: path.resolve(env.LESSON_HUB_BACKUP_DIR || 'server/data/backups'),
    backupEnabled: String(env.LESSON_HUB_BACKUP_ENABLED || 'false').toLowerCase() === 'true',
    backupIntervalHours: integer(env.LESSON_HUB_BACKUP_INTERVAL_HOURS, 24, 1, 24 * 30),
    backupRetentionCount: integer(env.LESSON_HUB_BACKUP_RETENTION, 14, 2, 365),
    operationsIntervalMs: integer(env.LESSON_HUB_OPERATIONS_INTERVAL_MS, 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
  });
}
