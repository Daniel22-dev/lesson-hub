# Lesson Hub – technické standardy převzaté z AI Studio GHRAB a Generátoru testů

## Zdrojové projekty

- AI Studio GHRAB 0.18.11
- Generátor interaktivních testů 7.1.4

Tento dokument odděluje společné standardy ekosystému od implementací specifických pouze pro Generátor.

## 1. Povinná identita Lesson Hubu

- Doporučené aplikační ID: `lesson-hub`.
- ID musí být shodné v aplikačním manifestu, přístupové politice AI Studia, bootstrapu Access Guardu, oprávněních, QA manifestu a Studio Bridge.
- Lesson Hub má zůstat samostatnou aplikací / repozitářem federovaného ekosystému AI Studia.
- Aplikace má zveřejňovat `studio-manifest.json` podle schématu `ai-studio-app-manifest-v1`.

Povinná pole manifestu:

- `schema`
- `id`
- `name.cs`, `name.en`
- `version`
- `status.cs`, `status.en`
- `description.cs`, `description.en`
- `launchUrl`
- `manualUrl`
- `repository`
- `icon`
- `accent`

Doplňková pole:

- `tags`
- `capabilities`
- `compatibility`
- `publishedAt`

## 2. Centrální přístup AI Studia

AI Studio používá podepsané oprávnění uložené pod klíčem:

`ghrab.access.permit.v2`

Přístupová vrstva ověřuje zejména:

- podpis ECDSA P-256 / SHA-256,
- vydavatele a publikum,
- časovou platnost,
- revokaci,
- roli uživatele,
- konkrétní aplikační ID.

Lesson Hub musí být chráněn i při přímém otevření URL, nikoli pouze kartou v AI Studiu.

Doporučený bootstrap:

1. `<html data-ghrab-access="checking">`.
2. Během kontroly skrýt tělo stránky.
3. Načíst `/AI-Studio-GHRAB/access/access-gate.css`.
4. Načíst `/AI-Studio-GHRAB/access/app-guard.js`.
5. Zavolat `protectApp('lesson-hub', { studioUrl: '/AI-Studio-GHRAB/' })`.
6. Vlastní aplikační skripty spustit až po úspěšném ověření.
7. Při timeoutu, chybě sítě nebo nedostupnosti konfigurace zůstat fail-closed.
8. Při zamítnutí zobrazit jednotnou zamykací obrazovku s návratem do AI Studia.

Pro statický build lze vlastní skripty držet inertní například pomocí:

`type="application/ghrab-protected"`

Po úspěchu je bootstrap převede na spustitelné skripty.

## 3. Studio Bridge a handoff

Společné datové formáty:

- `ghrab-material-v1` – přenositelný výukový materiál,
- `ghrab-handoff-v1` – krátkodobá předávka mezi aplikacemi,
- Studio Bridge 1.1.

Klíče používané ve stejném originu:

- `ghrab.handoff.v1`
- `ghrab.pilot.events.v2`

Lesson Hub má při převzetí handoffu ověřit:

- správné schéma,
- `target: "lesson-hub"`,
- expiraci,
- základní validitu materiálu,
- velikostní a obsahové limity.

Po úspěšném převzetí se handoff odstraní. Handoff není šifrovaný; smí obsahovat pouze anonymní, veřejný nebo smyšlený obsah.

## 4. Branding a vlastnictví

Referenční aplikace používá:

- školní logo,
- text `GYMNÁZIUM, OSTRAVA-HRABŮVKA`,
- alt text `Logo Gymnázia, Ostrava-Hrabůvka`,
- vlastnickou patičku:
  - `Vlastník aplikace: Daniel Baláž · Gymnázium, Ostrava-Hrabůvka`
  - `© 2026 Daniel Baláž. Všechna práva vyhrazena.`

Hlavička dále obsahuje:

- tlačítko interaktivního manuálu s ikonou knihy,
- badge verze / data / build hashe,
- stav vydání,
- uživatelský chip centrálního přístupu,
- administrátorské odkazy pouze pro roli admin,
- Test Lab / diagnostiku pouze pro správce.

Lesson Hub nemá dále používat provizorní značku `LH`; převezme skutečné školní logo ze zdrojů AI Studia.

## 5. Interaktivní manuál

- Každá aplikace drží vlastní manuál ve vlastním repozitáři.
- `manualUrl` je povinnou částí aplikačního manifestu.
- Manuál musí být chráněn stejným Access Guardem jako aplikace.
- AI Studio pouze katalogizuje adresu manuálu; nekopíruje jeho obsah.
- Ikona manuálu má být kniha, aby byla zachována konzistence ekosystému.

## 6. PWA standard

Lesson Hub má obsahovat:

- `manifest.webmanifest`,
- ikony 32, 48, 72, 96, 128, 192 a 512 px,
- maskovatelnou ikonu 512 px,
- Apple touch ikonu,
- vlastní service worker,
- jednoznačný cache prefix obsahující aplikaci a verzi.

Service worker musí:

- mazat pouze cache vlastního prefixu,
- nepoškodit cache jiných aplikací na stejném originu,
- nepolykat chybu povinného precache souboru,
- bezpečně pracovat s více navigačními cestami,
- neprovádět nečekaný reload rozpracované práce,
- mít definované offline chování.

## 7. Build a verze

Produkční build vzniká ze zdrojů do `dist/`. Zdroj pravdy není ručně upravovaný `dist`.

Verze musí být synchronizovaná minimálně v:

- `package.json`,
- centrální konstantě aplikace / release objektu,
- cache názvu service workeru,
- PWA manifestu,
- `studio-manifest.json`,
- `qa/qa-manifest.json`.

Build má automaticky:

- zkontrolovat shodu verzí,
- vytvořit `dist/`,
- doplnit čas buildu,
- vytvořit `studio-manifest.json` ze šablony,
- zablokovat neoprávněné označení neodsouhlasené verze jako produkční.

## 8. GHRAB QA Standard

Lesson Hub musí převzít společnou QA bránu a příkazy:

- `qa:technical`
- `qa:security`
- `qa:pwa`
- `qa:combinatorial`
- `qa:visual`
- `qa:critical`
- `qa:report`
- `qa:approve`
- `qa:release`

Povinné soubory:

- `qa/qa-manifest.json`
- `qa/visual-plan.json`
- `qa/critical-flows.json`
- `qa/combinatorial-plan.json`
- `qa/manual-approval.schema.json`
- společné `scripts/qa-*.mjs`
- dokumentace QA standardu a správce.

Povinné vizuální viewporty:

- 360×800
- 412×915
- 768×1024
- 1366×768
- 1920×1080

QA nesmí kontrolovat pouze přítomnost prvku v DOM. Musí projít reálné workflow a ověřit:

- prázdnou nebo skrytou stránku,
- konzolové chyby,
- page errors a unhandled rejections,
- lokální 404,
- překryvy a prvky mimo viewport,
- horizontální přetékání,
- načtení obrázků,
- kritická workflow,
- kombinatorické scénáře a invarianty.

Povinné výstupy QA:

- `qa-report.json`
- `qa-report.html`
- `release-verdict.txt`
- `qa-screenshots/`
- `qa-differences/`
- `qa-logs/`
- `qa-test-matrix.csv`
- `manual-review-checklist.md`

Možné verdikty:

- `NOT_READY`
- `AUTOMATED_READY`
- `READY_WITH_MINOR_ISSUES`
- `READY`

Ruční vizuální schválení i deployed smoke test musí být vázány na appId, verzi a SHA-256 konkrétního buildu.

## 9. Bezpečnostní a datové zásady relevantní pro Lesson Hub

- Žádné soukromé klíče, přístupové soubory, API klíče nebo ostré studentské seznamy v repozitáři.
- Lokální selhání úložiště se nesmí vydávat za úspěšné uložení.
- Access Guard musí při chybě zůstat fail-closed.
- Citlivá data studentů minimalizovat.
- Handoff nepoužívat pro osobní údaje.
- Exporty a importy validovat.
- Před migrací databáze vytvořit zálohu a ověřit integritu.
- Nová potvrzená chyba má dostat regresní test.

## 10. Co se z Generátoru nekopíruje mechanicky

Následující prvky jsou specifické pro Generátor a nejsou standardem Lesson Hubu:

- aplikační ID `generator`,
- oranžový akcent `#f59e0b`,
- logika Gemini API,
- bezpečné studentské testy a teacher verifier,
- whitelist konkrétního e-mailu v bezpečnostním QA,
- testovací workflow zaměřené na tvorbu testů,
- jednorázové kódy studentů,
- app-specific zdrojová struktura číslovaných classic scriptů.

Lesson Hub může používat modernější modulární zdrojovou strukturu, pokud zachová Access Guard, manifest, PWA, QA, verze a integrační kontrakty.

## 11. Povinné opravy původní Vlny 1

Před pokračováním do funkční Vlny 2 je vhodné vytvořit opravnou verzi 0.1.1:

1. nahradit provizorní logo skutečným školním logem;
2. doplnit přesnou vlastnickou patičku;
3. zavést appId `lesson-hub`;
4. doplnit centrální Access Guard a fail-closed bootstrap;
5. doplnit aplikační manifest AI Studia;
6. doplnit interaktivní manuál a jeho ochranu;
7. doplnit Studio Bridge 1.1;
8. doplnit PWA manifest, ikony a service worker s vlastním cache prefixem;
9. zavést synchronizaci verzí a produkční build do `dist/`;
10. převzít GHRAB QA standard, manifesty, vizuální plán a kritická workflow;
11. vytvořit skutečný headless smoke test;
12. po opravách znovu vydat ZIP Vlny 1 jako verzi 0.1.1.

## Závěr

AI Studio GHRAB je federovaný ekosystém samostatných PWA aplikací se společnou identitou, přístupovou bránou, aplikačními manifesty, předáváním anonymních materiálů, chráněnými manuály a jednotnou QA certifikací. Lesson Hub musí tyto smlouvy převzít před rozvojem funkčního datového jádra, aby pozdější integrace nevyžadovala přepis celé aplikace.

## 12. Serverový standard od verze 0.8.0

První serverová vrstva je oddělena od statického PWA buildu a používá Node.js 20+ bez dalších runtime závislostí.

Povinné principy:

- centrální Access Guard AI Studia chrání vstup do klienta;
- samostatná serverová relace chrání synchronizovaná data;
- hesla se nikdy neukládají v otevřeném tvaru a používají `scrypt` s unikátní solí;
- bearer token se na serveru ukládá pouze jako SHA-256 digest;
- relace mají omezenou platnost a lze je explicitně ukončit;
- přístup se řídí rolemi `owner`, `admin`, `teacher`, `substitute`;
- učitel ve výchozím stavu vidí pouze vlastní záznamy;
- serverový datový soubor nesmí být součástí veřejného PWA buildu;
- produkční provoz musí používat HTTPS reverzní proxy a omezený seznam CORS originů;
- změny se přenášejí kontraktem `lesson-hub-sync-v1`;
- konfliktní verze se nesmí tiše přepsat;
- správa účtů, přihlášení a synchronizace vytvářejí serverovou auditní stopu;
- serverová vrstva musí mít samostatný API test a klient-server integrační test.

Serverový JSON store je vhodný pro pilotní a školní nasazení s omezeným počtem uživatelů. Při větším provozu lze zachovat API kontrakt a nahradit úložiště relační databází bez přepisu klientských doménových služeb.
