import { SCHEMA_VERSION } from './schema.js';

export const migrations = Object.freeze([
  {
    version: 1,
    label: 'Počáteční local-first schéma',
    apply() {},
  },
  {
    version: 2,
    label: 'Akademické jádro: školní roky, předměty, skupiny a nové indexy',
    apply() {
      // Indexy jsou doplněny deklarativně v onupgradeneeded. Záznamy z v1 zůstávají kompatibilní.
    },
  },
  {
    version: 3,
    label: 'Jádro hodin: plán, časová osa, rychlý zápis a automatické ukládání',
    apply() {
      // Entita lessons existovala od v1. Verze 3 rozšiřuje její doménová pole bez destruktivní migrace.
    },
  },
  {
    version: 4,
    label: 'Povinnosti, připomínky, reflexe a štítky',
    apply() {
      // Úložiště existovala od v1. Verze 4 přidává indexy a nová volitelná pole bez ztráty starších dat.
    },
  },
  {
    version: 5,
    label: 'Knihovna materiálů, vazby a globální vyhledávání',
    apply() {
      // Úložiště materiálů a vazeb existovala od v1. Verze 5 doplňuje indexy a volitelná metadata bez destruktivní migrace.
    },
  },
  {
    version: 6,
    label: 'Export, import, lokální body obnovy a rozšířená diagnostika',
    apply() {
      // Nové úložiště backupSnapshots je vytvořeno deklarativně. Uživatelská data zůstávají beze změny.
    },
  },
  {
    version: 7,
    label: 'Šablony hodin, cyklická výuka, hromadné operace a server-ready fronta',
    apply() {
      // lessonTemplates získávají nové indexy; teachingCycles a syncQueue vznikají deklarativně.
      // Skupiny a materiály jsou rozšířeny pouze o volitelná pole, takže starší data zůstávají kompatibilní.
    },
  },
  {
    version: 8,
    label: 'Serverové účty, obousměrná synchronizace, konflikty a auditní oprávnění',
    apply() {
      // syncQueue získává resource index a syncConflicts vzniká deklarativně.
      // Serverová relace zůstává mimo exportovaná pedagogická data.
    },
  },
  {
    version: 9,
    label: 'Studenti, komunikační koncepty, plánované zprávy a serverové přílohy',
    apply() {
      // Nová úložiště vznikají deklarativně. Starší pedagogická data se nemění.
    },
  },
  {
    version: 10,
    label: 'Doručování zpráv, audit zásilek a režim zastupování',
    apply() {
      // Doručenky a zastupovací entity vznikají deklarativně; starší data zůstávají kompatibilní.
    },
  },
]);

export function getMigrationSummary() {
  return {
    currentSchemaVersion: SCHEMA_VERSION,
    registeredMigrations: migrations.map(({ version, label }) => ({ version, label })),
  };
}
