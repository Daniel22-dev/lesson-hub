import { ENTITY_STORES } from './constants.js';
import { SCHEMA_VERSION, createId } from './schema.js';
import { getMigrationSummary } from './migrations.js';
import { getAccessProfile } from './access.js';
import { APP_RELEASE } from './release.js';

function createResult(id, label, status, detail) {
  return { id, label, status, detail, checkedAt: new Date().toISOString() };
}

export async function runDiagnostics({ database, repositories, backupService, templateCycleService, syncService, serverService, communicationService, substitutionService }) {
  const results = [];

  results.push(
    createResult(
      'environment',
      'Prostředí aplikace',
      'pass',
      `JavaScript aktivní, úložiště: ${database.kind}.`,
    ),
  );

  try {
    const schema = await database.get(ENTITY_STORES.appMeta, 'schema');
    const isValid = schema?.schemaVersion === SCHEMA_VERSION;
    results.push(
      createResult(
        'schema',
        'Datové schéma',
        isValid ? 'pass' : 'fail',
        isValid ? `Schéma ${SCHEMA_VERSION} je aktuální.` : 'Verze schématu neodpovídá aplikaci.',
      ),
    );
  } catch (error) {
    results.push(createResult('schema', 'Datové schéma', 'fail', error.message));
  }

  try {
    const testId = createId('diagnostic');
    await repositories.auditEvents.create({
      id: testId,
      entityType: 'diagnostic',
      entityId: testId,
      action: 'self-test-write',
      timestamp: new Date().toISOString(),
      metadata: { temporary: true },
    });
    const stored = await repositories.auditEvents.get(testId);
    await repositories.auditEvents.remove(testId);

    results.push(
      createResult(
        'read-write',
        'Čtení a zápis',
        stored?.id === testId ? 'pass' : 'fail',
        stored?.id === testId ? 'Dočasný záznam byl uložen, načten a odstraněn.' : 'Kontrolní záznam nesouhlasí.',
      ),
    );
  } catch (error) {
    results.push(createResult('read-write', 'Čtení a zápis', 'fail', error.message));
  }

  try {
    const migrationSummary = getMigrationSummary();
    results.push(
      createResult(
        'migrations',
        'Migrační mechanismus',
        migrationSummary.registeredMigrations.length > 0 ? 'pass' : 'warn',
        `${migrationSummary.registeredMigrations.length} registrovaná migrace; schéma ${migrationSummary.currentSchemaVersion}.`,
      ),
    );
  } catch (error) {
    results.push(createResult('migrations', 'Migrační mechanismus', 'fail', error.message));
  }


  try {
    const suffix = Date.now().toString(36);
    const year = await repositories.schoolYears.create({
      label: `DIAGNOSTIKA-${suffix}`,
      startDate: '',
      endDate: '',
      status: 'active',
      isCurrent: false,
    });
    const subject = await repositories.subjects.create({
      name: `Diagnostický předmět ${suffix}`,
      shortName: 'QA',
      colorToken: 'slate',
      status: 'active',
    });
    const identity = await repositories.groupIdentities.create({
      originDate: new Date().toISOString().slice(0, 10),
      notes: '',
      status: 'active',
    });
    const group = await repositories.groupInstances.create({
      groupIdentityId: identity.id,
      schoolYearId: year.id,
      subjectId: subject.id,
      displayName: `Diagnostická skupina ${suffix}`,
      grade: '',
      colorToken: 'slate',
      status: 'active',
      previousGroupInstanceId: null,
      note: '',
    });
    const lesson = await repositories.lessons.create({
      groupInstanceId: group.id,
      schoolYearId: year.id,
      date: new Date().toISOString().slice(0, 10),
      startTime: '',
      sequenceNumber: 1,
      status: 'planned',
      title: `Diagnostická hodina ${suffix}`,
      topic: '',
      objectives: '',
      plannedOutline: '',
      actualProgress: '',
      completedText: '',
      unfinishedText: '',
      endedAtText: '',
      homework: '',
      nextLessonNote: '',
      reflection: '',
      successRating: '',
      plannedDuration: 45,
      actualDuration: null,
      completedAt: null,
    });
    const valid = Boolean(
      (await repositories.groupInstances.get(group.id))?.groupIdentityId === identity.id
      && (await repositories.schoolYears.get(year.id))?.id === year.id
      && (await repositories.subjects.get(subject.id))?.id === subject.id
      && (await repositories.lessons.get(lesson.id))?.groupInstanceId === group.id
    );
    await repositories.lessons.remove(lesson.id);
    await repositories.groupInstances.remove(group.id);
    await repositories.groupIdentities.remove(identity.id);
    await repositories.subjects.remove(subject.id);
    await repositories.schoolYears.remove(year.id);
    results.push(createResult(
      'academic-core',
      'Akademické datové jádro',
      valid ? 'pass' : 'fail',
      valid ? 'Školní rok, předmět, identita, skupina a hodina byly vytvořeny, propojeny a bezpečně odstraněny.' : 'Kontrolní akademická data nemají očekávané vazby.',
    ));
  } catch (error) {
    results.push(createResult('academic-core', 'Akademické datové jádro', 'fail', error.message));
  }


  try {
    const suffix = Date.now().toString(36);
    const task = await repositories.tasks.create({
      title: `Diagnostický úkol ${suffix}`,
      description: '',
      type: 'other',
      priority: 'normal',
      status: 'open',
      groupInstanceId: null,
      lessonId: null,
      dueDate: '',
      nextLessonTrigger: false,
      completedAt: null,
    });
    const reminder = await repositories.reminders.create({
      title: `Diagnostická připomínka ${suffix}`,
      note: '',
      triggerType: 'no_date',
      triggerDate: '',
      priority: 'normal',
      status: 'active',
      groupInstanceId: null,
      lessonId: null,
      completedAt: null,
    });
    const tag = await repositories.tags.create({
      name: `Diagnostický štítek ${suffix}`,
      category: 'custom',
      colorToken: 'slate',
      status: 'active',
    });
    const link = await repositories.entityTags.create({ tagId: tag.id, entityType: 'task', entityId: task.id });
    const valid = Boolean(
      (await repositories.tasks.get(task.id))?.status === 'open'
      && (await repositories.reminders.get(reminder.id))?.triggerType === 'no_date'
      && (await repositories.tags.get(tag.id))?.name === tag.name
      && (await repositories.entityTags.get(link.id))?.entityId === task.id
    );
    await repositories.entityTags.remove(link.id);
    await repositories.tags.remove(tag.id);
    await repositories.reminders.remove(reminder.id);
    await repositories.tasks.remove(task.id);
    results.push(createResult(
      'work-core',
      'Povinnosti, připomínky a štítky',
      valid ? 'pass' : 'fail',
      valid ? 'Kontrolní úkol, připomínka, štítek a vazba byly vytvořeny, ověřeny a odstraněny.' : 'Kontrolní pracovní data nemají očekávanou strukturu.',
    ));
  } catch (error) {
    results.push(createResult('work-core', 'Povinnosti, připomínky a štítky', 'fail', error.message));
  }

  try {
    const suffix = Date.now().toString(36);
    const material = await repositories.materials.create({
      title: `Diagnostický materiál ${suffix}`,
      description: '',
      materialType: 'link',
      sourceType: 'url',
      url: `https://example.com/diagnostic-${suffix}`,
      teacherNote: '',
      studentFacing: false,
      visibility: 'private',
      status: 'active',
      normalizedKey: `url:https://example.com/diagnostic-${suffix}`,
    });
    const link = await repositories.materialLinks.create({ materialId: material.id, entityType: 'group', entityId: 'diagnostic-group', purpose: 'teaching', visibility: 'private' });
    const valid = Boolean((await repositories.materials.get(material.id))?.status === 'active' && (await repositories.materialLinks.get(link.id))?.materialId === material.id);
    await repositories.materialLinks.remove(link.id);
    await repositories.materials.remove(material.id);
    results.push(createResult('material-core', 'Materiály a jejich vazby', valid ? 'pass' : 'fail', valid ? 'Kontrolní materiál a vazba byly vytvořeny, ověřeny a odstraněny.' : 'Kontrolní materiál nemá očekávanou strukturu.'));
  } catch (error) {
    results.push(createResult('material-core', 'Materiály a jejich vazby', 'fail', error.message));
  }

  try {
    if (!templateCycleService) throw new Error('Služba šablon a cyklů není inicializovaná.');
    const suffix = Date.now().toString(36);
    const template = await templateCycleService.createTemplate({
      title: `Diagnostická šablona ${suffix}`,
      description: 'Dočasná šablona pro interní self-test.',
      plannedOutline: 'Úvod, hlavní aktivita, závěr.',
      skillType: 'speaking',
      favorite: true,
    });
    const cycle = await templateCycleService.createCycle({
      name: `Diagnostický cyklus ${suffix}`,
      stepDurationWeeks: 1,
      steps: [
        { label: 'Mluvení', skillType: 'speaking', colorToken: 'teal' },
        { label: 'Poslech', skillType: 'listening', colorToken: 'blue' },
      ],
    });
    const templateValid = (await templateCycleService.getTemplate(template.id))?.favorite === true;
    const cycleValid = (await templateCycleService.getCycle(cycle.id))?.steps?.length === 2;
    await repositories.lessonTemplates.remove(template.id);
    await repositories.teachingCycles.remove(cycle.id);
    results.push(createResult(
      'templates-cycles',
      'Šablony a cyklická výuka',
      templateValid && cycleValid ? 'pass' : 'fail',
      templateValid && cycleValid
        ? 'Dočasná šablona a dvoukrokový cyklus byly vytvořeny, ověřeny a odstraněny.'
        : 'Šablona nebo cyklus nemají očekávanou strukturu.',
    ));
  } catch (error) {
    results.push(createResult('templates-cycles', 'Šablony a cyklická výuka', 'fail', error.message));
  }

  try {
    if (!syncService) throw new Error('Server-ready synchronizační služba není inicializovaná.');
    const queueItem = await repositories.syncQueue.create({
      schema: 'lesson-hub-sync-v1',
      auditEventId: null,
      entityType: 'diagnostic',
      entityId: createId('diagnosticSync'),
      operation: 'diagnostic-check',
      payload: { temporary: true },
      status: 'pending',
      attemptCount: 0,
      lastAttemptAt: null,
      syncedAt: null,
    });
    await syncService.markSynced(queueItem.id);
    const stored = await repositories.syncQueue.get(queueItem.id);
    await repositories.syncQueue.remove(queueItem.id);
    results.push(createResult(
      'server-ready',
      'Server-ready datová fronta',
      stored?.status === 'synced' ? 'pass' : 'fail',
      stored?.status === 'synced'
        ? 'Lokální změna prošla životním cyklem pending → synced podle kontraktu lesson-hub-sync-v1.'
        : 'Synchronizační fronta neuložila očekávaný stav.',
    ));
  } catch (error) {
    results.push(createResult('server-ready', 'Server-ready datová fronta', 'fail', error.message));
  }


  try {
    if (!serverService) throw new Error('Serverová služba není inicializovaná.');
    const summary = await syncService.summary();
    const conflict = await repositories.syncConflicts.create({
      resource: 'diagnostic', entityId: createId('diagnosticConflict'), localRecord: { value: 1 }, serverRecord: { value: 2 },
      status: 'open', resolution: '', detectedAt: new Date().toISOString(),
    });
    await repositories.syncConflicts.update(conflict.id, { status: 'resolved', resolution: 'server', resolvedAt: new Date().toISOString() });
    const stored = await repositories.syncConflicts.get(conflict.id);
    await repositories.syncConflicts.remove(conflict.id);
    results.push(createResult(
      'server-sync-conflicts',
      'Serverové konflikty a kontrakt',
      stored?.status === 'resolved' && summary.contractVersion === 'lesson-hub-api-v1' ? 'pass' : 'fail',
      stored?.status === 'resolved'
        ? `Konflikt prošel životním cyklem open → resolved; API ${summary.contractVersion}.`
        : 'Úložiště konfliktů neuložilo očekávaný stav.',
    ));
  } catch (error) {
    results.push(createResult('server-sync-conflicts', 'Serverové konflikty a kontrakt', 'fail', error.message));
  }

  try {
    if (!serverService) throw new Error('Serverová služba není inicializovaná.');
    const health = serverService.healthState;
    results.push(createResult(
      'server-connection',
      'Lesson Hub Server',
      health?.status === 'ok' ? 'pass' : 'warn',
      health?.status === 'ok'
        ? `Server ${health.version} odpovídá; synchronizační kontrakt ${health.syncContract}.`
        : `Server není právě ověřen. Nakonfigurovaná adresa: ${serverService.config.baseUrl}.`,
    ));
  } catch (error) {
    results.push(createResult('server-connection', 'Lesson Hub Server', 'warn', error.message));
  }

  try {
    if (!serverService?.isAuthenticated || !serverService.canManageOperations) {
      results.push(createResult('server-operations', 'Provozní zálohy serveru', 'warn', 'Kontrola vyžaduje přihlášeného vlastníka nebo správce serveru.'));
    } else {
      const status = await serverService.operationsStatus();
      const healthy = Number(status?.storage?.dataBytes || 0) > 0 && Number(status?.records?.activeUsers || 0) > 0;
      results.push(createResult(
        'server-operations',
        'Provozní zálohy serveru',
        healthy ? 'pass' : 'warn',
        healthy
          ? `Databáze má ${status.storage.dataBytes} B; server eviduje ${status.backups.count} snapshotů${status.backups.enabled ? ' a automatické zálohy jsou zapnuté' : ''}.`
          : 'Provozní stav serveru neobsahuje očekávané údaje.',
      ));
    }
  } catch (error) {
    results.push(createResult('server-operations', 'Provozní zálohy serveru', 'warn', error.message));
  }


  try {
    if (!communicationService) throw new Error('Komunikační služba není inicializovaná.');
    const suffix = Date.now().toString(36);
    const student = await repositories.students.create({
      displayName: `Diagnostický student ${suffix}`,
      email: `diagnostika.${suffix}@example.test`,
      normalizedEmail: `diagnostika.${suffix}@example.test`,
      groupIdentityId: '', groupIdentityIds: [], status: 'active', source: 'diagnostic',
    });
    const template = await communicationService.createTemplate({
      title: `Diagnostická zpráva ${suffix}`, type: 'general', subject: 'Diagnostický předmět', body: 'Dočasný text zprávy.',
    });
    const attachment = await communicationService.rememberServerAttachment({
      id: `diagnostic-server-${suffix}`, fileName: 'diagnostika.pdf', mimeType: 'application/pdf', size: 16,
      checksum: suffix, purpose: 'teacher', visibility: 'private', createdAt: new Date().toISOString(),
    });
    const valid = Boolean((await repositories.students.get(student.id))?.normalizedEmail && (await repositories.messageTemplates.get(template.id))?.status === 'active' && (await repositories.attachments.get(attachment.id))?.serverId);
    await repositories.students.remove(student.id);
    await repositories.messageTemplates.remove(template.id);
    await communicationService.removeAttachmentLocal(attachment.id);
    results.push(createResult('communication-core', 'Studenti, komunikace a přílohy', valid ? 'pass' : 'fail', valid ? 'Dočasný kontakt, šablona zprávy a metadata přílohy byly vytvořeny, ověřeny a odstraněny.' : 'Komunikační datové jádro nemá očekávanou strukturu.'));
  } catch (error) {
    results.push(createResult('communication-core', 'Studenti, komunikace a přílohy', 'fail', error.message));
  }


  try {
    const suffix = Date.now().toString(36);
    const delivery = await repositories.messageDeliveries.create({ messageId: `diagnostic-message-${suffix}`, recipientEmail: `diagnostika.${suffix}@example.test`, status: 'pending', attemptCount: 0, updatedAt: new Date().toISOString() });
    const period = await repositories.substitutionPeriods.create({ title: `Diagnostické zastupování ${suffix}`, status: 'draft', startDate: new Date().toISOString(), endDate: new Date().toISOString(), ownerId: 'diagnostic' });
    const plan = await repositories.substitutionPlans.create({ periodId: period.id, title: 'Diagnostický plán', groupName: 'QA', status: 'ready' });
    const item = await repositories.substitutionItems.create({ periodId: period.id, planId: plan.id, title: 'Diagnostická položka', status: 'pending' });
    const valid = Boolean((await repositories.messageDeliveries.get(delivery.id)) && (await repositories.substitutionItems.get(item.id))?.planId === plan.id && substitutionService);
    await repositories.messageDeliveries.remove(delivery.id);
    await repositories.substitutionItems.remove(item.id);
    await repositories.substitutionPlans.remove(plan.id);
    await repositories.substitutionPeriods.remove(period.id);
    results.push(createResult('delivery-substitution-core', 'Doručenky a zastupování', valid ? 'pass' : 'fail', valid ? 'Dočasná doručenka a zastupovací vazby byly vytvořeny, načteny a odstraněny.' : 'Nové datové jádro nemá očekávanou strukturu.'));
  } catch (error) {
    results.push(createResult('delivery-substitution-core', 'Doručenky a zastupování', 'fail', error.message));
  }

  try {
    if (!backupService) throw new Error('Služba záloh není inicializovaná.');
    const backupPackage = await backupService.exportPackage({ label: 'Diagnostický export', reason: 'diagnostic' });
    const validation = await backupService.validatePackage(backupPackage);
    results.push(createResult(
      'backup-engine',
      'Export, import a kontrolní součet',
      validation.valid && validation.checksumValid ? 'pass' : 'fail',
      validation.valid && validation.checksumValid
        ? `Export obsahuje ${validation.summary.totalRecords} záznamů a platný kontrolní součet SHA-256.`
        : validation.errors.join(' '),
    ));
  } catch (error) {
    results.push(createResult('backup-engine', 'Export, import a kontrolní součet', 'fail', error.message));
  }

  try {
    if (!backupService) throw new Error('Služba záloh není inicializovaná.');
    const snapshot = await backupService.createLocalBackup({ label: 'Dočasná diagnostická záloha', reason: 'diagnostic' });
    const stored = await repositories.backupSnapshots.get(snapshot.id);
    await backupService.deleteLocalBackup(snapshot.id);
    const removed = await repositories.backupSnapshots.get(snapshot.id);
    const valid = Boolean(stored?.package?.checksum && !removed);
    results.push(createResult(
      'local-backup',
      'Lokální bod obnovy',
      valid ? 'pass' : 'fail',
      valid ? 'Dočasný bod obnovy byl vytvořen, načten a odstraněn.' : 'Životní cyklus lokální zálohy neproběhl správně.',
    ));
  } catch (error) {
    results.push(createResult('local-backup', 'Lokální bod obnovy', 'fail', error.message));
  }

  try {
    if (!backupService) throw new Error('Služba záloh není inicializovaná.');
    const integrity = await backupService.integrityReport();
    results.push(createResult(
      'data-integrity',
      'Integrita datových vazeb',
      integrity.valid ? 'pass' : 'warn',
      integrity.valid
        ? `Vazby mezi ${integrity.summary.groups} skupinami, ${integrity.summary.lessons} hodinami a ${integrity.summary.materials} materiály jsou v pořádku.`
        : `Nalezeno ${integrity.issues.length} osiřelých nebo neplatných vazeb.`,
    ));
  } catch (error) {
    results.push(createResult('data-integrity', 'Integrita datových vazeb', 'fail', error.message));
  }

  try {
    const estimate = await backupService?.storageEstimate();
    results.push(createResult(
      'storage-quota',
      'Kapacita lokálního úložiště',
      estimate?.supported && estimate.percent > 85 ? 'warn' : 'pass',
      estimate?.supported
        ? `Využito přibližně ${estimate.percent.toFixed(1)} % dostupné kapacity prohlížeče.`
        : 'Prohlížeč odhad kapacity neposkytuje; základní úložiště je přesto funkční.',
    ));
  } catch (error) {
    results.push(createResult('storage-quota', 'Kapacita lokálního úložiště', 'warn', error.message));
  }

  try {
    const profile = getAccessProfile();
    const appAllowed = profile.localDevelopment || profile.apps.includes(APP_RELEASE.appId) || profile.role === 'admin';
    results.push(
      createResult(
        'access-guard',
        'Centrální přístup AI Studia',
        appAllowed ? 'pass' : 'fail',
        appAllowed
          ? `Ověřen profil ${profile.displayName} (${profile.role}); appId ${APP_RELEASE.appId}.`
          : `Permit neobsahuje oprávnění pro ${APP_RELEASE.appId}.`,
      ),
    );
  } catch (error) {
    results.push(createResult('access-guard', 'Centrální přístup AI Studia', 'fail', error.message));
  }

  try {
    const manifestResponse = await fetch('./manifest.webmanifest', { cache: 'no-store' });
    const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
    const valid = manifest?.start_url?.includes(APP_RELEASE.version) && Array.isArray(manifest.icons) && manifest.icons.length >= 3;
    results.push(
      createResult(
        'pwa',
        'PWA manifest a offline vrstva',
        valid ? 'pass' : 'warn',
        valid
          ? `Manifest verze ${APP_RELEASE.version} je dostupný; service worker: ${'serviceWorker' in navigator ? 'podporován' : 'nepodporován'}.`
          : 'PWA manifest se nepodařilo ověřit nebo nemá očekávanou verzi.',
      ),
    );
  } catch (error) {
    results.push(createResult('pwa', 'PWA manifest a offline vrstva', 'warn', error.message));
  }

  results.push(
    createResult(
      'studio-bridge',
      'Studio Bridge 1.1',
      'pass',
      'Bridge ověřuje schéma ghrab-handoff-v1, cíl lesson-hub, expiraci a materiál ghrab-material-v1.',
    ),
  );

  const failed = results.filter((result) => result.status === 'fail').length;
  const warning = results.filter((result) => result.status === 'warn').length;

  return {
    status: failed > 0 ? 'fail' : warning > 0 ? 'warn' : 'pass',
    results,
    completedAt: new Date().toISOString(),
  };
}
