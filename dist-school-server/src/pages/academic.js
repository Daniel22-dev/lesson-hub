import { appState } from '../core/appState.js';
import { escapeHtml } from '../core/html.js';
import { icon } from '../ui/icons.js';
import { confirmAction } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { openPromotionDialog, openSubjectDialog, openYearDialog } from '../ui/academicDialogs.js';
import { emptyState, sectionHeader, statusPill } from './shared.js';

function yearCard(year, groupCount) {
  return `
    <article class="academic-row ${year.isCurrent ? 'is-current' : ''}" data-year-id="${year.id}">
      <div class="academic-row__icon">${icon('calendar', 21)}</div>
      <div class="academic-row__main"><div><strong>${escapeHtml(year.label)}</strong>${year.isCurrent ? statusPill('Aktuální', 'success', 'check') : ''}${year.status === 'archived' ? statusPill('Archivovaný', 'neutral', 'archive') : ''}</div><span>${year.startDate ? new Date(year.startDate).toLocaleDateString('cs-CZ') : 'začátek neuveden'} – ${year.endDate ? new Date(year.endDate).toLocaleDateString('cs-CZ') : 'konec neuveden'} · ${groupCount} skupin</span></div>
      <div class="academic-row__actions">
        ${!year.isCurrent && year.status !== 'archived' ? `<button class="button button--ghost button--small" type="button" data-year-action="current" data-year-id="${year.id}">Nastavit aktuální</button>` : ''}
        <button class="icon-button icon-button--small" type="button" data-year-action="edit" data-year-id="${year.id}" aria-label="Upravit školní rok">${icon('edit', 17)}</button>
        ${!year.isCurrent && year.status !== 'archived' ? `<button class="icon-button icon-button--small" type="button" data-year-action="archive" data-year-id="${year.id}" aria-label="Archivovat školní rok">${icon('archive', 17)}</button>` : ''}
      </div>
    </article>`;
}

function subjectCard(subject, groupCount) {
  return `
    <article class="academic-row" data-subject-id="${subject.id}">
      <span class="subject-monogram subject-monogram--${subject.colorToken}">${escapeHtml(subject.shortName || subject.name.slice(0, 2))}</span>
      <div class="academic-row__main"><div><strong>${escapeHtml(subject.name)}</strong>${subject.status === 'archived' ? statusPill('Archivovaný', 'neutral', 'archive') : ''}</div><span>${groupCount} ${groupCount === 1 ? 'skupina' : 'skupin'} napříč školními roky</span></div>
      <div class="academic-row__actions"><button class="icon-button icon-button--small" type="button" data-subject-action="edit" data-subject-id="${subject.id}" aria-label="Upravit předmět">${icon('edit', 17)}</button>${subject.status !== 'archived' ? `<button class="icon-button icon-button--small" type="button" data-subject-action="archive" data-subject-id="${subject.id}" aria-label="Archivovat předmět">${icon('archive', 17)}</button>` : ''}</div>
    </article>`;
}

export async function academicPage() {
  const [years, subjects, groups] = await Promise.all([
    appState.academicService.listSchoolYears(),
    appState.academicService.listSubjects({ includeArchived: true }),
    appState.repositories.groupInstances.list(),
  ]);
  return {
    title: 'Školní roky a předměty',
    description: 'Základní struktura výuky a bezpečný postup skupin mezi ročníky.',
    actions: `<button class="button button--secondary" type="button" data-open-subject>${icon('book', 17)} Nový předmět</button><button class="button button--primary" type="button" data-open-year>${icon('plus', 17)} Nový školní rok</button>`,
    content: `
      <nav class="breadcrumb"><a href="#/groups">Skupiny</a>${icon('chevron', 15)}<span>Správa výuky</span></nav>
      <section class="academic-hero">
        <div><span class="topbar__eyebrow">Kontinuita výuky</span><h2>Historie skupiny nesmí záviset na jejím názvu</h2><p>Každá skupina má trvalou identitu. Průvodce postupem vytvoří její novou podobu v dalším školním roce, aniž by přerušil předchozí historii.</p></div>
        <button class="button button--primary" type="button" data-open-promotion>${icon('arrowUp', 18)} Spustit postup skupin</button>
      </section>
      <div class="two-column-grid academic-columns">
        <section class="content-card">
          ${sectionHeader('Školní roky', 'Jeden rok je vždy označen jako aktuální.', `<button class="button button--ghost button--small" type="button" data-open-year>${icon('plus', 15)} Přidat</button>`)}
          ${years.length ? `<div class="academic-list">${years.map((year) => yearCard(year, groups.filter((group) => group.schoolYearId === year.id).length)).join('')}</div>` : emptyState({ iconName: 'calendar', title: 'Chybí školní rok', text: 'Vytvořte první období pro svou výuku.', action: '<button class="button button--secondary" type="button" data-open-year>Přidat školní rok</button>' })}
        </section>
        <section class="content-card">
          ${sectionHeader('Předměty', 'Předmět lze používat ve více skupinách a letech.', `<button class="button button--ghost button--small" type="button" data-open-subject>${icon('plus', 15)} Přidat</button>`)}
          ${subjects.length ? `<div class="academic-list">${subjects.map((subject) => subjectCard(subject, groups.filter((group) => group.subjectId === subject.id).length)).join('')}</div>` : emptyState({ iconName: 'book', title: 'Chybí předmět', text: 'Přidejte první vyučovaný předmět.', action: '<button class="button button--secondary" type="button" data-open-subject>Přidat předmět</button>' })}
        </section>
      </div>
      <aside class="notice notice--info">${icon('shield', 20)}<div><strong>Bezpečná archivace</strong><p>Aktuální školní rok nelze archivovat. Předmět používaný aktivní skupinou také nelze archivovat, dokud nejsou skupiny bezpečně ukončeny.</p></div></aside>`,
  };
}

export function bindAcademicPage() {
  document.querySelectorAll('[data-open-year]').forEach((button) => button.addEventListener('click', () => openYearDialog()));
  document.querySelectorAll('[data-open-subject]').forEach((button) => button.addEventListener('click', () => openSubjectDialog()));
  document.querySelector('[data-open-promotion]')?.addEventListener('click', openPromotionDialog);

  document.querySelectorAll('[data-year-action]').forEach((button) => button.addEventListener('click', async () => {
    const year = await appState.repositories.schoolYears.get(button.dataset.yearId);
    if (!year) return;
    try {
      if (button.dataset.yearAction === 'edit') openYearDialog(year);
      if (button.dataset.yearAction === 'current') {
        await appState.academicService.setCurrentSchoolYear(year.id);
        await appState.refreshAcademic();
        showToast(`${year.label} je nyní aktuální školní rok.`, 'success');
      }
      if (button.dataset.yearAction === 'archive') {
        confirmAction({
          title: `Archivovat ${year.label}?`,
          message: 'Školní rok zůstane dostupný v historii. Skupiny a jejich záznamy se nesmažou.',
          confirmLabel: 'Archivovat školní rok',
          onConfirm: async () => {
            await appState.academicService.archiveSchoolYear(year.id);
            await appState.refreshAcademic();
            showToast('Školní rok byl archivován.', 'success');
          },
        });
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }));

  document.querySelectorAll('[data-subject-action]').forEach((button) => button.addEventListener('click', async () => {
    const subject = await appState.repositories.subjects.get(button.dataset.subjectId);
    if (!subject) return;
    try {
      if (button.dataset.subjectAction === 'edit') openSubjectDialog(subject);
      if (button.dataset.subjectAction === 'archive') {
        confirmAction({
          title: `Archivovat předmět ${subject.name}?`,
          message: 'Archivovaný předmět nebude možné vybrat pro nové skupiny. Historické záznamy zůstanou zachovány.',
          confirmLabel: 'Archivovat předmět',
          onConfirm: async () => {
            await appState.academicService.archiveSubject(subject.id);
            await appState.refreshAcademic();
            showToast('Předmět byl archivován.', 'success');
          },
        });
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }));
}
