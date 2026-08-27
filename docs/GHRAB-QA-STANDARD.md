# GHRAB QA Standard 1.0.2

## 1. Účel a rozsah

GHRAB QA Standard je jednotná release brána pro aplikace ekosystému AI Studio GHRAB. Cílem je vytvořit opakovatelný důkaz, že konkrétní verze prošla vlastními testy aplikace, společnými technickými, bezpečnostními, PWA, kombinatorickými a vizuálními kontrolami, kritickými workflow a následnou lidskou kontrolou.

Automatický zelený běh sám o sobě nikdy neznamená stav READY.

## 2. Klasifikace nálezů

- **BLOCKER**: aplikace, build, nasazení, centrální přístup, hlavní workflow nebo ochrana dat jsou nefunkční či nebezpečné; hrozí ztráta nebo únik dat; výstup nelze vytvořit, otevřít či vyhodnotit.
- **MAJOR**: významná funkční, vizuální, bezpečnostní, PWA, exportní, bodovací, časová, identifikační nebo pravdivostní chyba. BLOCKER a MAJOR blokují vydání.
- **MINOR**: objektivní kosmetická, textová nebo ergonomická vada bez zásadního dopadu na použitelnost.
- **PREFERENCE**: subjektivní stylistická volba bez objektivního dopadu. Preference není chybou a nepatří mezi release nálezy.

## 3. Povinné automatické brány

Každý projekt musí mít jeden příkaz `npm run qa:release`, který z čistého stavu provede:

1. reprodukovatelné `npm ci` podle lockfilu;
2. původní interní testy a případný Test Lab;
3. produkční build;
4. `npm audit --audit-level=high`;
5. společnou technickou kontrolu;
6. bezpečnostní a datovou kontrolu;
7. PWA a deployment kontrolu;
8. kombinatorické scénáře;
9. skutečný Chromium vizuální běh;
10. kritická workflow;
11. vytvoření jednotného reportu.

Každý úplný průchod musí nejprve odstranit staré výsledky. Chybějící nový výsledek povinné brány nebo pád skriptu je BLOCKER. Report nesmí převzít starý zelený stav.

## 4. Technická brána

Minimálně kontroluje:

- shodu verze mezi `package.json`, PWA manifestem, service-worker cache, changelogem a QA manifestem;
- lockfile a zákaz interních či lokálních registry URL;
- chybějící a neexistující importy;
- citlivé soubory a nechtěné build artefakty;
- `.gitignore` pro `node_modules/`, `qa-results/` a build adresář;
- absenci absolutních interních cest v testech;
- konzistenci GitHub workflow a podmínku QA před deployem;
- statické invarianty přiměřené architektuře aplikace;
- že `dist` není zdrojem pravdy, pokud vzniká v CI.

## 5. Bezpečnost a ochrana dat

Minimálně se kontrolují:

- API klíče, hesla, tokeny a typické vzory Gemini klíčů;
- commitované citlivé konfigurační soubory;
- nebezpečné použití `innerHTML`, neescapované HTML, XSS a CSV formula injection;
- localStorage a srozumitelné chování při `QuotaExceededError`;
- fail-closed chování centrálního access guardu;
- revokovaný, neplatný, offline nebo nedostupný permit;
- oddělení tajemství od studentských exportů;
- anonymizace a pseudonymizace tam, kde je aplikace vyžaduje;
- síťová chyba a neúplná AI odpověď nesmějí vést k falešnému úspěchu;
- osobní údaje nesmějí být odesílány bez nutnosti a uživatel musí vědět, co se odesílá.

Statická kontrola je doplněk, nikoli důkaz absolutní bezpečnosti. Rizikové funkce musí mít konkrétní regresní nebo workflow test.

## 6. PWA a deployment brána

U každého PWA cíle se ověřuje:

- platný manifest, `id`, `start_url`, scope a existující ikony;
- registrace service workeru;
- existence všech precache položek proti skutečnému buildu;
- unikátní prefix cache aplikace;
- aktivace nemaže cache jiné aplikace;
- online bezpečnostní komponenty se nezmrazí ve staré cache;
- update nereaguje nebezpečným reloadem rozpracované práce;
- offline fallback je definovaný a neskrývá chybějící assety;
- GitHub deploy je závislý na úspěšném QA jobu.

## 7. Vizuální brána

Používá se skutečný Chromium nebo Playwright Chromium. Povinné základní viewporty jsou:

- 360×800;
- 412×915;
- 768×1024;
- 1366×768;
- 1920×1080.

Podle rizika se doplňuje 125 %, 150 % nebo 200 % zoom a mobilní orientace na šířku.

Každý scénář v `qa/visual-plan.json` musí uvádět ID, vstupní URL, kroky, očekávaný text či selektor, povinně viditelné prvky, viewporty a zakázané překryvy.

Automatika minimálně ověřuje:

- `html` ani `body` nejsou skryté;
- screenshot není prázdný, celý bílý nebo celý černý;
- očekávaný text a ovládací prvky jsou skutečně viditelné;
- kritický prvek má kladnou velikost a neleží mimo viewport;
- interaktivní fullscreen overlay není prázdný a neblokuje obsah bez ovládání;
- horizontální přetékání neodsunulo důležité ovládání;
- obrázky jsou načtené;
- není chyba konzole, page error, unhandled rejection nebo lokální 404.

Dekorativní vrstvy, například hvězdy, viněta, mlha nebo stín, se nesmějí falešně hlásit jako blokující overlay, pokud mají `pointer-events: none` a nebrání obsahu.

## 8. Ruční kontrola galerie

Člověk musí otevřít všechny screenshoty aktuálního běhu. Kontroluje zejména poškozená slova, nesprávné překlady krátkých tokenů, zásadní oříznutí obrázků, příliš malé písmo, kontrast, nelogické pořadí, posunutý text, prázdné obrazovky s formálně existujícím DOM a záměnu úvodního modalu za hlavní stav.

Ruční schválení je vázáno na `appId`, verzi a SHA-256 buildu. Baseline se nesmí automaticky schvalovat během deploye.

## 9. Kombinatorické testování

Aplikace s více volbami musí mít:

- pokrytí každé hodnoty jednotlivého parametru;
- pairwise pokrytí všech dvojic;
- explicitní rizikové trojice;
- pevné referenční scénáře;
- invarianty platné pro každý scénář.

Report uvádí počet parametrů, teoretických kombinací, skutečně spuštěných scénářů, počet pokrytých dvojic, procento pairwise pokrytí a rizikové trojice.

## 10. Kritická workflow

Každé workflow má ID, výchozí stav, přesné kroky, očekávaný výsledek, důkaz a PASS/FAIL. Kritická workflow nesmějí být nahrazena pouze kontrolou existence elementu v DOM.

## 11. Povinné artefakty

Každá aplikace vytváří:

- `qa-report.json`;
- `qa-report.html`;
- `release-verdict.txt`;
- `qa-screenshots/`;
- `qa-differences/` nebo prázdnou připravenou oblast pro rozdíly;
- `qa-logs/`;
- `qa-test-matrix.csv`;
- `manual-review-checklist.md`.

JSON report obsahuje aplikaci, verzi, verzi standardu, datum, commit, SHA-256 buildu, výsledky bran, PASS/WARN/FAIL, BLOCKER a MAJOR nálezy, MINOR nálezy, přeskočené kontroly s důvodem a automatický i výsledný verdikt.

## 12. Release verdikty

- `NOT_READY`: existuje BLOCKER nebo MAJOR.
- `AUTOMATED_READY`: automatika je zelená, ale chybí platná ruční galerie nebo deployed smoke test.
- `READY_WITH_MINOR_ISSUES`: automatika, ruční galerie a deployed smoke test prošly; zbývají pouze MINOR vady.
- `READY`: všechny brány, ruční galerie a deployed smoke test prošly bez známé BLOCKER, MAJOR nebo MINOR vady.

## 13. Verze standardu

Změna významu brány, manifestu nebo reportu zvyšuje minor nebo major verzi standardu. Kompatibilní nový regresní test zvyšuje patch verzi. Nová významná třída chyby se vždy posoudí pro všechny aplikace.

## 14. Povinné společné regrese 1.0.1

- service worker smí mazat pouze cache vlastního prefixu;
- prázdná nebo skrytá stránka nesmí projít vizuální branou;
- interaktivní fullscreen overlay musí obsahovat viditelný obsah nebo ovládání;
- překlady krátkých tokenů (`ON`, `OFF`, `OK`, `NO`) nesmějí měnit části vlastních jmen a běžných slov;
- selhání localStorage a sítě nesmí být vydáváno za úspěch;
- centrální guard musí při chybě, timeoutu nebo nedostupnosti zůstat fail-closed;
- skript chráněný guardem se musí inicializovat i po proběhlém `DOMContentLoaded`;
- pád povinné brány nebo chybějící nový výsledek je BLOCKER;
- každý běh nejprve odstraní staré QA důkazy;
- generované cesty musí být v `.gitignore`;
- vizuální scénář musí odlišit úvodní modal od skutečné pracovní obrazovky.


## 15. Povinné společné regrese 1.0.2

Verze 1.0.2 přidává kontroly odvozené z hloubkového auditu Hodnotitele 1.5.0:

- runtime JavaScript cílený na běžné školní prohlížeče nesmí používat regex lookbehind, pokud manifest výslovně nedeklaruje odpovídající minimální podporu;
- service worker nesmí tiše polykat chybu povinného precache souboru; chybějící asset musí zablokovat neúplnou offline instalaci;
- aplikace s více navigačními vstupy nesmí každou online navigaci ukládat pod jediný klíč `index.html` a tím přepisovat offline kořen nebo manuál;
- AI aplikace mohou a u významných auditních nálezů musí připojit projektový `qa/security-validator.mjs`, který ověřuje konkrétní datové a workflow invarianty;
- surové modelové odpovědi, citace a kandidáti se nesmějí ukládat do dlouhodobého stavu bez výslovné, zdůvodněné potřeby a minimalizačního testu;
- dávkové výsledky bez stabilního identifikačního klíče se nesmějí přiřazovat podle pořadí;
- oříznutá nebo neúplná AI odpověď nesmí vést k falešnému úspěchu;
- technické markery importu nesmějí měnit obsah, počet slov ani první větu uživatelského dokumentu;
- pseudonymní identifikátory navázané na výsledky se nesmějí recyklovat;
- obrazový či PDF vstup bez získaného a učitelem potvrzeného textu nesmí být hodnocen jako prázdná práce;
- trvalé uložení API klíče musí vyžadovat explicitní potvrzení uživatele.

Tyto body nejsou všechny univerzální pro každou aplikaci. Společné jádro proto poskytuje obecné statické brány a standardizovaný projektový validátor pro specializované invarianty.
## Čistý stav a samostatnost příkazů

`qa:release` před projektovými kontrolami odstraní deklarovaný build adresář. Každý příkaz uvedený v `qa-manifest.json` proto musí fungovat ze zdrojového repozitáře bez starého `dist/`. Test nebo headless kontrola, která build potřebuje, musí mít vlastní `pretest` / `pretest:headless` krok nebo build výslovně spustit. Tím se zabrání falešnému PASS založenému na zastaralém lokálním výstupu.

