# Reakce na hloubkový audit Lesson Hubu 1.1.0

**Opravné vydání:** Lesson Hub 1.1.2  
**Datum uzavření oprav:** 30. 7. 2026  
**Účel:** příprava čistého zdrojového balíčku pro GitHub a local-first pilot

## Výchozí stav

Audit správně označil verzi 1.1.0 jako nevhodnou ke zveřejnění. Obsahoval pět blokujících, deset vysoce závažných, devatenáct středních a dvanáct nízkých nálezů. Verze 1.1.2 proto není běžné funkční rozšíření, ale bezpečnostní a provozní opravné vydání.

Všechny nálezy byly posouzeny a promítnuty do kódu, QA infrastruktury nebo dokumentace. U nasazení na GitHub Pages, čisté instalace závislostí, `npm audit` a reálného školního SMTP zůstává nutné externí ověření, které nelze dokončit uvnitř pracovního kontejneru.

## Blokující nálezy

| ID | Stav | Provedený zásah | Regresní důkaz |
|---|---|---|---|
| B1 | Implementováno; čeká první nasazení | Workflow nyní provede QA, build, GitHub Pages upload a deploy. Po úspěšném nasazení může volitelně odeslat `repository_dispatch` do AI Studia. `dist/` se sestavuje v CI. | Kontrola workflow a produkčního buildu; po pushi je nutné ověřit HTTP 200 na `/lesson-hub/manifest.webmanifest`. |
| B2 | Opraveno | Společný layout escapuje externí a uživatelské řetězce. Toast používá DOM uzly a `textContent`; varianty mají whitelist. | Zpřísněná bezpečnostní brána: 0 nálezů. Jednotkový test ověřuje, že nebezpečnou interpolaci do `innerHTML` skutečně zachytí. |
| B3 | Opraveno | Sdílené a substituční záznamy jsou pro cizího učitele pouze ke čtení. Zápis a mazání jsou povoleny jen vlastníkovi nebo správní roli. Hodnota `visibility` má whitelist. | Serverový regresní test zakazuje učiteli B upravit, smazat nebo schválit sdílený záznam učitele A. |
| B4 | Opraveno | Zápisová fronta se po chybě zotaví, používá `fsync` a atomický `rename`. Server sleduje po sobě jdoucí selhání perzistence a po překročení limitu ukončí proces. | Regresní test vyvolá chybu zápisu a následně ověří úspěšné zotavení. |
| B5 | Opraveno | CI už nesmí maskovat neprovedené `npm ci`, `npm audit` ani browserovou bránu. XSS kontrola pracuje po řádcích a wrappery nepolykají chyby Playwrightu. Lokální síťová nedostupnost vede jen k `AUTOMATED_INCOMPLETE`; v GitHub Actions je blockerem. | Technická, bezpečnostní, PWA, kombinační, kritická a vizuální brána prošly. Bezpečnostní test obsahuje úmyslně nebezpečný vzorek a očekává jeho detekci. |

## Vysoce závažné nálezy

| ID | Stav | Provedený zásah |
|---|---|---|
| H1 | Opraveno | SMTP autentizace je při výchozím `LESSON_HUB_SMTP_REQUIRE_TLS=true` zakázána bez skutečně aktivního TLS. Downgrade STARTTLS končí trvalou chybou. |
| H2 | Opraveno | Částečný PATCH položky zastupování zachová `substituteNote` i `realizedAt`, pokud nejsou výslovně poslány. |
| H3 | Opraveno | Retenční úklid vyhodnocuje politiku po jednotlivých vlastnících a vrací rozpad náhledu podle vlastníka. Při mazání příloh uklízí také vazby. |
| H4 | Opraveno | Synchronizační fronta používá vysokou značku v `appMeta` a deterministické ID odvozené z auditní události. Vyčištění odeslaných položek už nemůže znovu odeslat starou historii. |
| H5 | Opraveno | Přechod do dočasné paměti je zřetelně a trvale varován. Blokované povýšení IndexedDB nepřepne aplikaci potichu do paměti; staré karty reagují na `versionchange`. |
| H6 | Opraveno | Zprávy uvízlé ve stavu `sending` mají `sendingStartedAt` a po překročení limitu se vrátí do zpracovatelného stavu. Vynucené ruční opakování je podporováno. |
| H7 | Opraveno | Server eviduje nejstarší dostupný kurzor. Příliš starý klient dostane `409 cursor_too_old` a provede úplnou obnovu zdrojů. |
| H8 | Opraveno | Klientský audit se ořezává na časový a početní limit. Není součástí běžného exportu, lokální zálohy jsou omezeny na tři a před vytvořením se kontroluje kvóta úložiště. |
| H9 | Opraveno | PWA má stabilní `id: /lesson-hub/`, neměnný `start_url` a QA tuto identitu kontroluje. Verze se ověřuje přes build metadata. |
| H10 | Opraveno | Obnova serveru používá provozní zámek, čerstvý pre-restore snapshot, rollback cesty a výslovně zneplatní relace. Klient po obnově relaci zahodí. |

## Středně závažné nálezy

| ID | Stav | Provedený zásah |
|---|---|---|
| M1 | Opraveno | Slabé heslo vrací HTTP 400 a kód `password_weak`. |
| M2 | Opraveno | Změna hesla nebo zákaz účtu zneplatní všechny jeho relace. |
| M3 | Opraveno | Přihlášení má samostatný limit podle účtu i IP adresy a úklid starých položek. |
| M4 | Opraveno | JSON, binární i prázdné odpovědi posílají bezpečnostní hlavičky; 429 obsahuje `Retry-After`. |
| M5 | Opraveno | Odebraný příjemce má čekající doručenku označenou jako `cancelled`. |
| M6 | Opraveno dokumentací a UI | Automatické snapshoty zůstávají bezpečně vypnuté, ale server i provozní centrum zobrazují výrazné varování. |
| M7 | Opraveno | Selhání zápisu nastavení po importu vrací varování, nikoli nepravdivou informaci o selhání již dokončeného importu dat. |
| M8 | Opraveno | Uložení vzhledu a dalších nastavení je ošetřeno; chyba úložiště se zobrazí uživateli bez pádu obsluhy. |
| M9 | Opraveno | Paměťová a IndexedDB implementace importu mají shodné chování. Režim `replace` čistí všechna exportovatelná úložiště. |
| M10 | Opraveno | Pull synchronizace opakuje dávky až do `hasMore=false` a má pojistku proti nekonečné smyčce. |
| M11 | Opraveno | Ochrana konfliktů zahrnuje položky `pending` i `failed`. |
| M12 | Opraveno | Po pěti neúspěšných pokusech se změna přesune do stavu `blocked` a čeká na ruční řešení. |
| M13 | Opraveno | Klientský kontrakt a serverový seznam zdrojů jsou porovnávány integračním testem. |
| M14 | Opraveno | Bootstrap správce přijímá heslo pouze z chráněné proměnné prostředí, nikoli z argumentu příkazu. |
| M15 | Opraveno | Service worker signalizuje dostupnou novou verzi a nabízí její načtení. |
| M16 | Opraveno | Build generuje precache seznam ze skutečného obsahu `dist`; jednotlivé soubory se ukládají odděleně, aby jedna chyba nezrušila celou instalaci. |
| M17 | Opraveno | PATCH neexistujícího záznamu vrací 404 a nevytváří nový záznam. |
| M18 | Opraveno | Konflikt se posuzuje podle `serverRevision`; aplikace vzdálené změny zachovává serverové `updatedAt`. |
| M19 | Opraveno | Integrita kontroluje studenty, zprávy, doručenky, přílohy, vazby a entity zastupování. |

## Nízká závažnost a hygiena repozitáře

| ID | Stav | Provedený zásah |
|---|---|---|
| L1 | Opraveno | Z QA kódu byl odstraněn natvrdo zapsaný interní název registru. Lokální nedostupnost neveřejného registru se rozpoznává obecně a pouze mimo CI. |
| L2 | Opraveno | Procesní reporty byly přesunuty mimo veřejný balíček; GitHub ZIP neobsahuje historické vlny ani staré testovací protokoly. |
| L3 | Opraveno | Doplněny `LICENSE`, `.env.example`, `SECURITY.md` a `.nvmrc`. |
| L4 | Opraveno | Projekt, CI i dokumentace používají Node.js 22. |
| L5 | Opraveno | Vývojový server ověřuje cestu vůči kořenu včetně oddělovače. |
| L6 | Opraveno | `HttpApiGateway` podporuje poskytovatele autorizačního tokenu. |
| L7 | Opraveno | Escapování HTML je sjednoceno v `src/core/html.js`. |
| L8 | Opraveno | Serverová verze je součástí synchronizační kontroly verzí. |
| L9 | Opraveno | Neautentizovaný `/health` vrací pouze stav a verzi. |
| L10 | Opraveno | HTML QA report escapuje názvy bran, kódy, názvy aplikace i další interpolované hodnoty. |
| L11 | Opraveno | Produkční build nemá obecný localhost admin bypass; lokální QA přístup je omezen na automatizované prostředí s příznakem `qa=1`. |
| L12 | Opraveno | Vlastní SHA-256 fallback má testy proti známým vektorům a porovnání se standardní implementací. |

## Doplněné regresní testy

Byly přidány mimo jiné testy požadované auditem:

1. cizí učitel nesmí měnit ani mazat sdílený záznam;
2. zápisová fronta se po chybě zotaví;
3. změna statusu zastupování zachová poznámku;
4. retenční úklid respektuje vlastníka;
5. vyčištění synchronizační fronty znovu neodešle starou změnu;
6. příliš starý kurzor vrátí `cursor_too_old`;
7. slabé heslo vrátí 400;
8. změna hesla zneplatní token;
9. klientský a serverový seznam zdrojů se shodují;
10. bezpečnostní QA zachytí neescapovanou interpolaci do HTML.

Navíc byly přidány testy STARTTLS downgrade, zrušených doručenek, zotavení zprávy ze stavu `sending`, dávkového pullu, blokace opakovaných změn, úplné obnovy zdrojů, replace importu a známých SHA-256 vektorů.

## Výsledek kontrol verze 1.1.2

- `npm test`: PASS;
- technická brána: PASS;
- bezpečnostní brána: PASS, 0 nálezů;
- PWA brána: PASS;
- kombinační brána: PASS, 100% pairwise pokrytí;
- kritická workflow: PASS, 25/25;
- vizuální kontrola: PASS, 61/61;
- headless smoke test: PASS.

Lokální verdikt je **`AUTOMATED_INCOMPLETE`**, nikoli `AUTOMATED_READY`, protože pracovní kontejner nedokázal dokončit čisté `npm ci` a `npm audit` přes síťový registr. V GitHub Actions jsou obě kontroly povinné a jejich selhání vydání zablokuje.

## Podmínky před pilotem

Před použitím s reálnými daty musí být splněno:

1. repozitář se jmenuje přesně `lesson-hub`;
2. GitHub Actions skončí zeleně včetně `npm ci` a `npm audit`;
3. GitHub Pages vrátí HTTP 200 pro `/lesson-hub/manifest.webmanifest`;
4. projde smoke test stejného nasazeného buildu;
5. local-first export a obnova se otestují s anonymizovanými daty;
6. server, SMTP a skutečné studentské kontakty zůstanou vypnuté, dokud nebude dokončeno jejich samostatné provozní ověření.
