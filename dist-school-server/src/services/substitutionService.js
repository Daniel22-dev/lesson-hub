export const SUBSTITUTION_ITEM_STATUSES = Object.freeze({
  pending: 'Čeká', completed: 'Splněno', partial: 'Částečně splněno', not_completed: 'Nesplněno',
  moved: 'Přesunuto', adjusted: 'Upraveno', impossible: 'Nebylo možné realizovat',
});

function toDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

export class SubstitutionService {
  constructor(repositories, serverService, lessonService) {
    this.repositories = repositories;
    this.serverService = serverService;
    this.lessonService = lessonService;
  }

  async listMine() {
    if (!this.serverService?.isAuthenticated) return [];
    const all = await this.serverService.listSubstitutionPeriods();
    const userId = this.serverService.profile?.id;
    return all.filter((item) => item.ownerId === userId || ['owner', 'admin'].includes(this.serverService.role));
  }

  async listActive() {
    if (!this.serverService?.isAuthenticated) return [];
    return this.serverService.listActiveSubstitutions();
  }

  async createPeriod(input) { return this.serverService.createSubstitutionPeriod(input); }
  async updatePeriod(id, input) { return this.serverService.updateSubstitutionPeriod(id, input); }
  async createPlan(input) { return this.serverService.createSubstitutionPlan(input); }
  async updatePlan(id, input) { return this.serverService.updateSubstitutionPlan(id, input); }
  async createItem(input) { return this.serverService.createSubstitutionItem(input); }
  async updateItem(id, input) { return this.serverService.updateSubstitutionItem(id, input); }

  async importPeriodToHistory(periodId) {
    const bundle = await this.serverService.substitutionSummary(periodId);
    if (!bundle) throw new Error('Zastupovací období nebylo nalezeno.');
    const existing = await this.repositories.lessons.list();
    const imported = [];
    const skipped = [];
    for (const plan of bundle.plans || []) {
      if (!plan.groupInstanceId || !await this.repositories.groupInstances.get(plan.groupInstanceId)) {
        skipped.push({ planId: plan.id, reason: 'Skupina už v lokální databázi není dostupná.' });
        continue;
      }
      for (const item of plan.items || []) {
        if (!['completed', 'partial', 'adjusted'].includes(item.status)) continue;
        if (item.importedAt || existing.some((lesson) => lesson.substitutionSourceId === item.id)) continue;
        const lesson = await this.lessonService.createLesson({
          groupInstanceId: plan.groupInstanceId,
          date: toDate(item.realizedAt || item.date || bundle.endDate),
          status: 'substituted',
          title: item.title,
          topic: item.topic,
          objectives: item.objective,
          plannedOutline: item.instructions,
          actualProgress: item.substituteNote || item.expectedOutput,
          completedText: item.status === 'completed' ? 'Realizováno během zastupování.' : 'Částečně realizováno během zastupování.',
          unfinishedText: item.status === 'partial' ? item.substituteNote : '',
          nextLessonNote: item.status === 'partial' ? 'Zkontrolovat a dokončit po návratu.' : '',
          substitutionSourceId: item.id,
        });
        imported.push({ lesson, itemId: item.id });
      }
    }
    if (imported.length) await this.serverService.markSubstitutionImported(periodId, imported.map((item) => item.itemId));
    return { imported, skipped };
  }
}
