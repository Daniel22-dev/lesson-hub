# GHRAB QA — praktický návod správce

Tento návod je určen správci AI Studia GHRAB. Nevyžaduje znalost programování, ale předpokládá, že umíte otevřít terminál ve složce projektu a nahrát soubory do GitHubu.

## 1. Co QA brána dělá

Příkaz `npm run qa:release` provede jeden úplný certifikační průchod:

1. smaže staré QA výsledky, aby se nemohl znovu použít dřívější zelený stav;
2. provede čisté `npm ci` podle lockfilu;
3. spustí původní testy aplikace a build;
4. provede `npm audit --audit-level=high`;
5. zkontroluje technickou konzistenci, verze, citlivé soubory a workflow;
6. provede bezpečnostní a PWA kontroly;
7. spustí pairwise kombinatorické scénáře;
8. otevře aplikaci ve skutečném Chromiu a vytvoří screenshoty;
9. ověří kritická workflow;
10. vytvoří JSON, HTML a textový verdikt.

Automatický zelený běh sám o sobě neznamená, že je aplikace připravena k ostrému provozu. Člověk musí prohlédnout galerii a po nasazení provést krátký smoke test.

## 2. Co musí být v počítači

- Node.js podle verze uvedené v GitHub workflow projektu; nyní se používá Node 22.
- npm, které se nainstaluje spolu s Node.js.
- Chromium pro Playwright.
- připojení k internetu při prvním stažení závislostí a Chromia.

Ověření instalace:

```bash
node --version
npm --version
```

## 3. První lokální spuštění

Otevřete terminál v kořeni konkrétního projektu, tedy ve složce obsahující `package.json`.

```bash
npm ci
npx playwright install chromium
npm run qa:release
```

Na Linuxu v čistém CI prostředí se používá:

```bash
npx playwright install --with-deps chromium
```

Po úspěšném dokončení se v terminálu zobrazí `GHRAB QA RELEASE VERDICT`.

## 4. Kde najdete výsledky

Všechny důkazy vzniknou ve složce `qa-results/`:

- `qa-report.html` — hlavní report pro člověka;
- `qa-report.json` — strojově čitelný report;
- `release-verdict.txt` — jednořádkový verdikt;
- `qa-screenshots/` — galerie obrazovek;
- `qa-logs/` — podrobné logy jednotlivých příkazů;
- `qa-test-matrix.csv` — kombinatorické scénáře;
- `manual-review-checklist.md` — seznam pro ruční prohlídku;
- `technical.json`, `security.json`, `pwa.json`, `visual.json`, `critical.json`, `combinatorial.json` — výsledky jednotlivých bran.

## 5. Jak číst verdikty

### NOT_READY

Existuje alespoň jedna chyba BLOCKER nebo MAJOR. Tuto verzi nenasazujte. V reportu otevřete tabulku nálezů a podle sloupce `gate` zjistěte, zda jde o projekt, techniku, bezpečnost, PWA, vizuál, kombinace nebo kritické workflow.

### AUTOMATED_READY

Automatické brány jsou zelené, ale chybí ruční prohlídka galerie, deployed smoke test nebo obojí. Jde o kandidáta k nasazení, nikoli o konečný stav READY.

### READY_WITH_MINOR_ISSUES

Neexistuje BLOCKER ani MAJOR, ruční galerie i deployed smoke test byly potvrzeny, ale zůstávají pouze objektivní drobné vady MINOR. Ty musí být popsány v reportu.

### READY

Automatické brány, ruční galerie i deployed smoke test prošly pro tutéž aplikaci, verzi a SHA-256 buildu a nezůstala žádná známá BLOCKER, MAJOR ani MINOR vada.

## 6. Ruční kontrola screenshotů

Otevřete `qa-results/manual-review-checklist.md` a všechny soubory v `qa-results/qa-screenshots/`.

U každého snímku ověřte zejména:

- stránka není prázdná, skrytá, celá bílá nebo celá černá;
- nad obsahem neleží prázdná krycí vrstva;
- nadpisy, tlačítka a texty se nepřekrývají;
- důležité tlačítko není mimo obrazovku;
- text není nepřiměřeně malý nebo useknutý;
- obrázky nejsou zásadně oříznuté nebo nenačtené;
- vlastní jména a běžná slova nejsou poškozena překladovou náhradou;
- mobilní i desktopové obrazovky dávají smysl;
- úvodní modal a hlavní pracovní plocha nejsou omylem zaměněny za tentýž stav.

Po úspěšné prohlídce spusťte:

```bash
npm run qa:approve -- --visual-reviewed --reviewer "Daniel Baláž" --notes "Prohlédnuta celá galerie aktuálního buildu."
npm run qa:report
```

Schválení se uloží do `qa/manual-approval.json` a je vázáno na `appId`, verzi a SHA-256 buildu. Změní-li se build, schválení přestane být platné.

## 7. Deployed smoke test

Smoke test se provádí až na skutečně nasazené adrese po úspěchu GitHub Actions. Otevřete aplikaci v anonymním okně nebo po vymazání site data a proveďte krátké hlavní workflow popsané v samostatném souboru `SMOKE-TESTY.md` certifikačního balíku.

Po úspěšném smoke testu ve stejném lokálním buildu vytvořte potvrzení:

```bash
npm run qa:approve -- --visual-reviewed --deployed-smoke --reviewer "Daniel Baláž" --notes "Galerie i deployed smoke test prošly na produkční adrese."
npm run qa:report
```

Důležité: nový build, změna verze nebo změna souborů tvořících build vyžaduje nové schválení.

## 8. Co dělat při FAIL

1. Neodstraňujte kontrolu a nepřepisujte FAIL na WARN jen proto, aby release prošel.
2. Otevřete odpovídající log v `qa-results/qa-logs/`.
3. Rozhodněte, zda je chyba v aplikaci, nebo v QA testu.
4. Je-li chyba v testu, opravte test tak, aby stále kontroloval původní riziko.
5. Je-li chyba v aplikaci, opravte aplikaci a přidejte regresní test.
6. Zvažte, zda se stejná třída chyby může objevit i v ostatních aplikacích.
7. Zvyšte patch verzi aplikace.
8. Synchronizujte `package.json`, PWA manifest, service-worker cache, changelog a `qa/qa-manifest.json`.
9. Spusťte celý `npm run qa:release` znovu.
10. Znovu prohlédněte novou galerii. Staré schválení nepoužívejte.

## 9. Jak poznat typ problému

- `project-install.log`: lockfile, registry nebo instalace balíčků;
- `project-tests.log`: původní testy aplikace;
- `project-build.log`: build a chybějící soubory;
- `project-audit.log`: známé zranitelnosti závislostí;
- `qa-technical.log`: verze, importy, workflow, `.gitignore`, struktura;
- `qa-security.log`: tajemství, nebezpečné konstrukce, guard a ochrana dat;
- `qa-pwa.log`: manifest, ikony, precache a izolace cache;
- `qa-visual.log`: Chromium, překryvy, prázdné obrazovky, konzole a 404;
- `qa-critical.log`: hlavní workflow;
- `qa-combinatorial.log`: pairwise scénáře a invarianty.

## 10. Nahrání na GitHub

1. Zálohujte nebo označte poslední známý zelený commit.
2. Nahrajte obsah GitHub ZIPu přímo do kořene odpovídajícího repozitáře.
3. Nenahrávejte `node_modules`, `dist` ani `qa-results` jako zdroj pravdy.
4. Použijte doporučenou commit message z certifikačního balíku.
5. Otevřete kartu **Actions** na GitHubu.
6. Ověřte, že job nainstaloval Node, provedl `npm ci`, nainstaloval Chromium a spustil `npm run qa:release`.
7. Zkontrolujte, že QA artifact je dostupný ke stažení.
8. Deploy musí začít až po úspěšném QA jobu.
9. Po deployi otevřete skutečnou adresu a proveďte smoke test.

## 11. Obnova předchozí verze

Pokud nová verze po nasazení selže:

1. poznamenejte si adresu neúspěšné GitHub Action a projev chyby;
2. vraťte repozitář na poslední známý zelený commit nebo použijte GitHub **Revert**;
3. nevracejte pouze obsah `dist` — zdrojem pravdy je zdrojový kód a build skript;
4. nechte proběhnout QA a deploy obnovené verze;
5. ověřte produkci krátkým smoke testem;
6. chybu opravte v nové patch verzi, nikoli tichou změnou stejné verze.

## 12. Přidání nové aplikace

Do nové aplikace vložte společné:

- `scripts/qa-*.mjs`;
- `docs/GHRAB-QA-STANDARD.md`;
- `docs/GHRAB-QA-SPRAVCE.md`;
- `qa/manual-approval.schema.json`.

Vytvořte:

- `qa/qa-manifest.json`;
- `qa/visual-plan.json`;
- `qa/critical-flows.json`;
- `qa/combinatorial-plan.json`.

Do `package.json` přidejte stejné příkazy `qa:technical`, `qa:security`, `qa:pwa`, `qa:combinatorial`, `qa:visual`, `qa:critical`, `qa:report`, `qa:approve` a `qa:release`.

GitHub workflow musí před deployem nainstalovat Chromium, spustit `npm run qa:release` a uložit `qa-results` jako artifact.

## 13. Přidání testu po nové chybě

Po nalezení nové třídy chyby:

1. popište konkrétní původní projev;
2. vytvořte test, který na chybné verzi prokazatelně selže;
3. opravte aplikaci;
4. ověřte, že test nyní projde;
5. rozhodněte, zda je chyba přenositelná na jiné aplikace;
6. pokud ano, přidejte kontrolu do společného QA Core a zvyšte patch verzi standardu;
7. zopakujte certifikaci všech dotčených aplikací.

## 14. Co nikdy nedělat

- neschvalovat screenshoty bez jejich otevření;
- nepoužívat report z jiné verze;
- neupravovat ručně `release-verdict.txt`;
- nemažte invariant jen proto, že po refaktoru selhal;
- nenasazujte s BLOCKER nebo MAJOR nálezem;
- nepovažujte existenci screenshotu za důkaz, že stránka je použitelná;
- neukládejte API klíče nebo hesla do repozitáře;
- nepovažujte lokální PASS za potvrzení skutečné produkční adresy.


## Projektový bezpečnostní validátor

Pokud audit odhalí riziko specifické pro jednu aplikaci, společná brána může načíst soubor uvedený v `qa-manifest.json` jako `security.validator`. Validátor nesmí nahrazovat vlastní testy aplikace; převádí významné auditní invarianty do společného reportu. Jeho pád je BLOCKER.
### Proč QA maže `dist/`

Před každým úplným během se odstraní starý build. Když některý test hlásí, že `dist/` chybí, neopravujte to ručním ponecháním starého buildu. Projekt musí být nastaven tak, aby si potřebný build vytvořil sám. Jinak by mohl testovat jinou verzi, než kterou právě nahráváte.

