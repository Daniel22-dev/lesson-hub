import { ROUTES } from '../core/constants.js';
import { icon } from '../ui/icons.js';

const items = [
  ['Šablony a cykly', 'Opakované použití hodin, výukové cykly a hromadné plánování.', 'restore', `#/${ROUTES.templates}`],
  ['Povinnosti a připomínky', 'Otevřené úkoly, připomínky a osobní štítky.', 'check', `#/${ROUTES.work}`],
  ['Materiály', 'Knihovna odkazů a budoucích příloh.', 'materials', `#/${ROUTES.materials}`],
  ['Hledat', 'Globální vyhledávání napříč Lesson Hubem.', 'search', `#/${ROUTES.search}`],
  ['Školní roky a předměty', 'Správa období, předmětů a postupu skupin.', 'calendar', `#/${ROUTES.academic}`],
  ['Archiv skupin', 'Ukončené a historické podoby skupin.', 'archive', '#/groups?status=archived'],
  ['Komunikace', 'Studenti, odesílání zpráv, přílohy a retence.', 'user', `#/${ROUTES.communication}`],
  ['Zastupování', 'Omezené sdílení plánů a převzetí výsledků po návratu.', 'calendar', `#/${ROUTES.substitution}`],
  ['Server a synchronizace', 'Účty, role, konflikty a přenos mezi zařízeními.', 'shield', `#/${ROUTES.server}`],
  ['Data a zálohy', 'Export, import, body obnovy a kontrola dat.', 'database', `#/${ROUTES.data}`],
  ['Diagnostika', 'Self-testy, úložiště a stav aplikace.', 'diagnostics', `#/${ROUTES.diagnostics}`],
  ['Nastavení', 'Vzhled, hustota zobrazení a integrace.', 'settings', `#/${ROUTES.settings}`],
];

export function morePage() {
  return {
    title: 'Více',
    description: 'Správa aplikace, archiv, diagnostika a nastavení.',
    content: `<section class="menu-grid">${items.map(([title, description, iconName, href]) => `<a class="menu-card" href="${href}"><span class="menu-card__icon">${icon(iconName, 23)}</span><span><strong>${title}</strong><small>${description}</small></span>${icon('chevron', 20)}</a>`).join('')}</section>`,
  };
}
