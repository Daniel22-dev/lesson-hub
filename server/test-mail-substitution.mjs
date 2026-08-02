import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLessonHubServer } from './app.mjs';
import { hashPassword } from './lib/security.mjs';
import { SmtpMailAdapter } from './lib/mailer.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lesson-hub-wave10-'));
const config = {
  host: '127.0.0.1', port: 0,
  dataFile: path.join(dir, 'server.json'), attachmentsDir: path.join(dir, 'attachments'), allowedOrigins: ['http://localhost:4173'],
  sessionHours: 1, bodyLimitBytes: 12 * 1024 * 1024, attachmentLimitBytes: 8 * 1024 * 1024, loginWindowMs: 60_000, loginAttempts: 5,
  mailMode: 'file', mailFrom: ['lesson-hub', 'example.test'].join('@'), mailReplyTo: '', mailOutboxDir: path.join(dir, 'outbox'),
  mailSchedulerEnabled: true, mailSchedulerIntervalMs: 60_000, mailMaxAttempts: 3, mailRetryMinutes: 1,
  smtpHost: '', smtpPort: 587, smtpSecure: false, smtpStartTls: true, smtpUser: '', smtpPassword: '', smtpHeloName: 'lesson-hub.local',
};
const { server, store } = await createLessonHubServer({ config });
const now = new Date().toISOString();
store.data.users.push(
  { id: 'owner_1', email: ['owner', 'example.test'].join('@'), displayName: 'Owner Teacher', role: 'owner', status: 'active', passwordHash: hashPassword('OwnerPassword123'), createdAt: now, updatedAt: now },
  { id: 'sub_1', email: ['substitute', 'example.test'].join('@'), displayName: 'Substitute Teacher', role: 'substitute', status: 'active', passwordHash: hashPassword('Substitute1234'), createdAt: now, updatedAt: now },
);
await store.save();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function api(route, { token = '', ...options } = {}) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

try {
  const ownerLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: ['owner', 'example.test'].join('@'), password: 'OwnerPassword123' }) });
  const ownerToken = ownerLogin.payload.token;
  const subLogin = await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: ['substitute', 'example.test'].join('@'), password: 'Substitute1234' }) });
  const subToken = subLogin.payload.token;

  const message = await api('/v1/messages', { token: ownerToken, method: 'POST', body: JSON.stringify({
    id: 'message_delivery_test', subject: 'Test doručení', body: 'Bezpečný testovací text.', status: 'ready', requireApproval: false,
    recipients: [{ studentId: 'student_1', displayName: 'Student Test', email: ['student', 'example.test'].join('@') }], updatedAt: now,
  }) });
  assert.equal(message.response.status, 201);
  const send = await api('/v1/messages/message_delivery_test/send', { token: ownerToken, method: 'POST', body: '{}' });
  assert.equal(send.response.status, 200);
  assert.equal(send.payload.message.status, 'sent');
  assert.equal(send.payload.deliveries[0].status, 'sent');
  assert.equal((await readdir(config.mailOutboxDir)).some((name) => name.endsWith('.eml')), true);
  const deliveryList = await api('/v1/deliveries?messageId=message_delivery_test', { token: ownerToken });
  assert.equal(deliveryList.payload.items.length, 1);

  // Ověření skutečného SMTP protokolu proti izolovanému lokálnímu serveru.
  let smtpSource = '';
  const smtpServer = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 local.test ESMTP\r\n');
    let buffer = '';
    let dataMode = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        if (dataMode) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          smtpSource += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO /i.test(line)) socket.write('250-local.test\r\n250 PIPELINING\r\n');
        else if (/^MAIL FROM:/i.test(line)) socket.write('250 2.1.0 ok\r\n');
        else if (/^RCPT TO:/i.test(line)) socket.write('250 2.1.5 ok\r\n');
        else if (line === 'DATA') { dataMode = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (line === 'QUIT') { socket.write('221 2.0.0 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
  try {
    const smtpConfig = { ...config, mailMode: 'smtp', smtpHost: '127.0.0.1', smtpPort: smtpServer.address().port, smtpStartTls: false, smtpSecure: false };
    const smtpResult = await new SmtpMailAdapter(smtpConfig).send({
      to: ['smtp-recipient', 'example.test'].join('@'), subject: 'SMTP protocol test', text: 'Protocol body',
    });
    assert.equal(smtpResult.provider, 'smtp');
    assert.match(smtpSource, /To: smtp-recipient@example\.test/);
    assert.match(smtpSource, /Protocol body/);
    const tlsRequiredConfig = { ...smtpConfig, smtpRequireTls: true, smtpUser: 'audit-user', smtpPassword: 'audit-password' };
    await assert.rejects(
      () => new SmtpMailAdapter(tlsRequiredConfig).send({ to: ['tls-required', 'example.test'].join('@'), subject: 'TLS', text: 'Body' }),
      (error) => error.code === 'smtp_tls_required' && error.permanent === true,
    );
  } finally {
    await new Promise((resolve) => smtpServer.close(resolve));
  }

  const periodResponse = await api('/v1/substitution/periods', { token: ownerToken, method: 'POST', body: JSON.stringify({
    title: 'Testovací nepřítomnost', startDate: '2026-09-01', endDate: '2026-09-05', status: 'active', accessMode: 'all_substitutes', summary: 'Veřejné shrnutí', privateNotes: 'Soukromá poznámka',
  }) });
  assert.equal(periodResponse.response.status, 201);
  const period = periodResponse.payload.period;
  const planResponse = await api('/v1/substitution/plans', { token: ownerToken, method: 'POST', body: JSON.stringify({ periodId: period.id, groupInstanceId: 'group_local', groupName: '3.A', subjectName: 'Angličtina', title: 'Plán 3.A', instructions: 'Pracujte podle zadání.', privateNotes: 'Tajné metodické info' }) });
  assert.equal(planResponse.response.status, 201);
  const plan = planResponse.payload.plan;
  const itemResponse = await api('/v1/substitution/items', { token: ownerToken, method: 'POST', body: JSON.stringify({ planId: plan.id, title: 'Reading task', topic: 'Travel', objective: 'Porozumění textu', instructions: 'Strany 10–12', privateNotes: 'Nesdílet' }) });
  assert.equal(itemResponse.response.status, 201);
  const item = itemResponse.payload.item;

  const active = await api('/v1/substitution/active', { token: subToken });
  assert.equal(active.response.status, 200);
  assert.equal(active.payload.items.length, 1);
  assert.equal('privateNotes' in active.payload.items[0], false);
  assert.equal('privateNotes' in active.payload.items[0].plans[0], false);
  assert.equal('privateNotes' in active.payload.items[0].plans[0].items[0], false);

  const progress = await api(`/v1/substitution/items/${item.id}`, { token: subToken, method: 'PATCH', body: JSON.stringify({ status: 'partial', realizedAt: '2026-09-02', substituteNote: 'Dokončeny strany 10–11.' }) });
  assert.equal(progress.response.status, 200);
  assert.equal(progress.payload.item.status, 'partial');
  assert.equal(progress.payload.item.updatedBy, 'sub_1');

  const summary = await api(`/v1/substitution/periods/${period.id}/summary`, { token: ownerToken });
  assert.equal(summary.payload.item.plans[0].items[0].substituteNote.includes('10–11'), true);
  const imported = await api(`/v1/substitution/periods/${period.id}/imported`, { token: ownerToken, method: 'POST', body: JSON.stringify({ itemIds: [item.id] }) });
  assert.equal(imported.payload.imported, 1);

  console.log('Serverová vlna 3 prošla: souborové i SMTP doručení, doručenky, omezené zastupování a průběh suplujícího učitele.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
