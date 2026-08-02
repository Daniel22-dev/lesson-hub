import net from 'node:net';
import tls from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function header(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function address(value, label) {
  const normalized = header(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error(`${label} není platná e-mailová adresa.`);
  return normalized;
}

function encodeSubject(value) {
  const text = header(value);
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function messageSource({ from, to, subject, text, replyTo = '', messageId = '' }) {
  const safeFrom = address(from, 'Adresa odesílatele');
  const safeTo = address(to, 'Adresa příjemce');
  const safeReply = replyTo ? address(replyTo, 'Adresa pro odpověď') : '';
  const id = header(messageId) || `<${randomUUID()}@lesson-hub.local>`;
  const body = String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id.startsWith('<') ? id : `<${id}>`}`,
    ...(safeReply ? [`Reply-To: ${safeReply}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    '',
  ].join('\r\n');
}

function waitForReply(socket, acceptedCodes, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('SMTP server neodpověděl v časovém limitu.')), timeoutMs);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1) || '';
      if (!/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      if (!acceptedCodes.includes(code)) return finish(new Error(`SMTP odmítl operaci: ${last}`));
      finish(null, { code, text: buffer.trim() });
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function command(socket, value, acceptedCodes) {
  socket.write(`${value}\r\n`);
  return waitForReply(socket, acceptedCodes);
}

function connectSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP spojení překročilo časový limit.')));
    socket.once('error', reject);
  });
}

function upgradeTls(socket, host) {
  return new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket, servername: host, rejectUnauthorized: true }, () => resolve(upgraded));
    upgraded.once('error', reject);
  });
}

export class DisabledMailAdapter {
  constructor(config) { this.config = config; this.mode = 'disabled'; }
  get status() { return { mode: this.mode, configured: false, from: this.config.mailFrom || '', schedulerEnabled: false }; }
  async send() { throw Object.assign(new Error('E-mailová brána není nakonfigurovaná.'), { code: 'mail_disabled', permanent: true }); }
}

export class FileMailAdapter {
  constructor(config) { this.config = config; this.mode = 'file'; }
  get status() { return { mode: this.mode, configured: Boolean(this.config.mailFrom), from: this.config.mailFrom || '', schedulerEnabled: this.config.mailSchedulerEnabled }; }
  async send(message) {
    if (!this.config.mailFrom) throw Object.assign(new Error('Chybí LESSON_HUB_MAIL_FROM.'), { code: 'mail_from_missing', permanent: true });
    await mkdir(this.config.mailOutboxDir, { recursive: true });
    const id = `mail_${Date.now()}_${randomUUID()}`;
    const source = messageSource({ ...message, from: this.config.mailFrom, replyTo: this.config.mailReplyTo, messageId: `<${id}@lesson-hub.local>` });
    await writeFile(path.join(this.config.mailOutboxDir, `${id}.eml`), source, { mode: 0o600 });
    return { provider: 'file', providerMessageId: id, accepted: [message.to] };
  }
}

export class SmtpMailAdapter {
  constructor(config) { this.config = config; this.mode = 'smtp'; }
  get status() {
    return {
      mode: this.mode,
      configured: Boolean(this.config.smtpHost && this.config.mailFrom && (!this.config.smtpUser || this.config.smtpPassword)),
      from: this.config.mailFrom || '',
      schedulerEnabled: this.config.mailSchedulerEnabled,
      host: this.config.smtpHost || '',
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
    };
  }

  async send(message) {
    const config = this.config;
    if (!this.status.configured) throw Object.assign(new Error('SMTP brána nemá kompletní konfiguraci.'), { code: 'smtp_config_missing', permanent: true });
    let socket = await connectSocket({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure });
    try {
      await waitForReply(socket, [220]);
      let ehlo = await command(socket, `EHLO ${header(config.smtpHeloName || 'lesson-hub.local')}`, [250]);
      if (!config.smtpSecure && config.smtpStartTls && /STARTTLS/i.test(ehlo.text)) {
        await command(socket, 'STARTTLS', [220]);
        socket = await upgradeTls(socket, config.smtpHost);
        ehlo = await command(socket, `EHLO ${header(config.smtpHeloName || 'lesson-hub.local')}`, [250]);
      }
      const tlsActive = config.smtpSecure || socket instanceof tls.TLSSocket;
      if (config.smtpRequireTls && !tlsActive) {
        throw Object.assign(new Error('SMTP server nenabídl požadované TLS; spojení bylo ukončeno.'), {
          code: 'smtp_tls_required', permanent: true,
        });
      }
      if (config.smtpUser && !tlsActive) {
        throw Object.assign(new Error('SMTP přihlášení bez šifrovaného spojení není povoleno.'), {
          code: 'smtp_auth_requires_tls', permanent: true,
        });
      }
      if (config.smtpUser) {
        const credentials = Buffer.from(`\u0000${config.smtpUser}\u0000${config.smtpPassword}`, 'utf8').toString('base64');
        await command(socket, `AUTH PLAIN ${credentials}`, [235]);
      }
      const from = address(config.mailFrom, 'Adresa odesílatele');
      const to = address(message.to, 'Adresa příjemce');
      await command(socket, `MAIL FROM:<${from}>`, [250]);
      await command(socket, `RCPT TO:<${to}>`, [250, 251]);
      await command(socket, 'DATA', [354]);
      const providerMessageId = `mail_${randomUUID()}`;
      const source = messageSource({ ...message, from, replyTo: config.mailReplyTo, messageId: `<${providerMessageId}@${config.smtpHeloName || 'lesson-hub.local'}>` });
      socket.write(`${source}\r\n.\r\n`);
      await waitForReply(socket, [250]);
      await command(socket, 'QUIT', [221]).catch(() => null);
      return { provider: 'smtp', providerMessageId, accepted: [to] };
    } catch (error) {
      error.code ||= 'smtp_delivery_failed';
      if (error.permanent !== true) error.permanent = /^5\d\d/.test(String(error.message).match(/\b\d{3}\b/)?.[0] || '');
      throw error;
    } finally {
      socket.destroy();
    }
  }
}

export function createMailAdapter(config) {
  if (config.mailMode === 'smtp') return new SmtpMailAdapter(config);
  if (config.mailMode === 'file') return new FileMailAdapter(config);
  return new DisabledMailAdapter(config);
}
