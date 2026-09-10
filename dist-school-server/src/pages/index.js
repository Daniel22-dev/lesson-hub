import { ROUTES } from '../core/constants.js';
import { overviewPage, bindOverviewPage } from './overview.js';
import { groupsPage, bindGroupsPage } from './groups.js';
import { academicPage, bindAcademicPage } from './academic.js';
import { planPage, bindPlanPage } from './plan.js';
import { workPage, bindWorkPage } from './work.js';
import { materialsPage, bindMaterialsPage } from './materials.js';
import { searchPage, bindSearchPage } from './search.js';
import { morePage } from './more.js';
import { diagnosticsPage, bindDiagnosticsPage } from './diagnostics.js';
import { settingsPage, bindSettingsPage } from './settings.js';
import { dataPage, bindDataPage } from './data.js';
import { templatesPage, bindTemplatesPage } from './templates.js';
import { serverPage, bindServerPage } from './server.js';
import { communicationPage, bindCommunicationPage } from './communication.js';
import { substitutionPage, bindSubstitutionPage } from './substitution.js';

const pages = {
  [ROUTES.overview]: { render: overviewPage, bind: bindOverviewPage },
  [ROUTES.groups]: { render: groupsPage, bind: bindGroupsPage },
  [ROUTES.academic]: { render: academicPage, bind: bindAcademicPage },
  [ROUTES.plan]: { render: planPage, bind: bindPlanPage },
  [ROUTES.work]: { render: workPage, bind: bindWorkPage },
  [ROUTES.materials]: { render: materialsPage, bind: bindMaterialsPage },
  [ROUTES.search]: { render: searchPage, bind: bindSearchPage },
  [ROUTES.more]: { render: morePage },
  [ROUTES.diagnostics]: { render: diagnosticsPage, bind: bindDiagnosticsPage },
  [ROUTES.settings]: { render: settingsPage, bind: bindSettingsPage },
  [ROUTES.data]: { render: dataPage, bind: bindDataPage },
  [ROUTES.templates]: { render: templatesPage, bind: bindTemplatesPage },
  [ROUTES.server]: { render: serverPage, bind: bindServerPage },
  [ROUTES.communication]: { render: communicationPage, bind: bindCommunicationPage },
  [ROUTES.substitution]: { render: substitutionPage, bind: bindSubstitutionPage },
};

export function getPage(route) {
  return pages[route] ?? pages[ROUTES.overview];
}
