# Lesson Hub 1.2.17

**Aktuální verze:** 1.2.17  
**Platforma:** GHRAB Platform 1.1.2 · etapa P3


Lesson Hub je local-first osobní paměť učitele v ekosystému AI Studio GHRAB. Pro běžné pilotní používání **nepotřebuje server**: data ukládá do IndexedDB v prohlížeči a nabízí export, import i lokální body obnovy.

Serverová část je v repozitáři připravena pro budoucí školní nasazení, ale ve výchozím stavu není připojena, synchronizace je vypnutá a e-mailová brána je zakázaná.

## Integrace s AI Studiem GHRAB

Verze 1.2.17 je kandidát pro koordinovanou release wave AI Studia GHRAB a používá GHRAB Platform 1.1.2 se suite-session lifecycle kontraktem. Build publikuje `studio-manifest.json`, hlavní aplikaci i manuál chrání společný Access Guard, Studio Bridge přijímá pouze anonymní materiály `ghrab-material-v1` a pilotní telemetrie ukládá jen povolené technické počty bez obsahu výuky.

## Spuštění bez serveru

```bash
npm ci
npm start
```

Aplikace se otevře na `http://localhost:4173`. Produkční GitHub Pages build vytváří workflow `.github/workflows/deploy.yml` po úspěšném průchodu všech povinných QA bran.

## Nahrání na GitHub

1. Vytvořte repozitář s přesným názvem `lesson-hub`.
2. Nahrajte obsah ZIPu přímo do kořene repozitáře, nikoli do další vnořené složky.
3. Použijte větev `main`.
4. V **Settings → Pages** nastavte zdroj **GitHub Actions**.
5. Po pushnutí vyčkejte na zelený workflow **Certifikace a nasazení Lesson Hubu**.
6. Ověřte adresu `https://daniel22-dev.github.io/lesson-hub/manifest.webmanifest`.

Workflow nasazení nevydá aplikaci, pokud selže čistá instalace, bezpečnostní audit nebo některá povinná QA brána.

## Stabilizovaná GitHub QA

Verze 1.2.17 zachovává ověřené opravy z předchozího vydání a staví na zeleném běhu GitHub Actions:

- funkční kroky `evaluate` se nyní v Node Playwrightu i Python fallbacku skutečně vykonají; dříve se pouze vytvořil objekt funkce, takže se hash trasa nezměnila,
- headless smoke test používá explicitní lokální QA přístup a čeká na dokončený render požadované trasy.

Zachovány zůstávají předchozí opravy hashových cest, dynamického dnešního data, vizuálního reportéru, čekání na asynchronní render a bezpečnostní override `brace-expansion` 5.0.8. Kritická brána navíc při selhání vypíše konkrétní nález přímo do logu GitHub Actions.

## Bezpečné používání lokální verze

- Pravidelně stahujte úplný export v sekci **Data a zálohy**.
- Při varování „Data se nyní neukládají trvale“ nepokračujte v práci; obnovte IndexedDB nebo zavřete ostatní karty.
- Při pilotu používejte anonymizovaná data studentů.
- Serverové funkce nezapínejte bez HTTPS, záloh a schválené provozní konfigurace.

## Volitelný server

Server vyžaduje Node.js 22. První účet se vytváří heslem pouze z proměnné prostředí:

```bash
ADMIN_EMAIL="$LESSON_HUB_INITIAL_ADMIN_EMAIL" \
ADMIN_PASSWORD="$LESSON_HUB_INITIAL_ADMIN_PASSWORD" \
npm run server:init -- --name="Správce"

npm run server:start
```

Heslo se nepředává v argumentu příkazu. Podrobnosti jsou v `server/README.md` a `docs/SERVEROVE-NASAZENI-1.2.0.md`.

Automatické serverové snapshoty jsou ve výchozím stavu vypnuté. Server při startu i v provozním centru zobrazí výrazné varování, dokud není nastaveno `LESSON_HUB_BACKUP_ENABLED=true`.

## Kontroly

```bash
npm test
npm run qa:release
```

V GitHub Actions je neúspěšné nebo přeskočené `npm ci` či `npm audit` blokující. Lokální QA při nedostupném registru používá verdikt `AUTOMATED_INCOMPLETE`, nikoli `AUTOMATED_READY`.

## Navazující bezpečnostní audit

Verze 1.1.2 zapracovává také sedm zbytků z navazujícího auditu 1.1.1: rozšířenou detekci nebezpečných HTML šablon, amortizovaný úklid auditu, bezpečné zařazení obnovených dat do synchronizace, retenční rozsah `self`/`all`, poslední escapování layoutu, automatické verzování manuálu a úklid osiřelých snapshotů. Podrobná reakce je v `docs/REAKCE-NA-NAVAZNY-AUDIT-LESSON-HUB-1.1.2.md`.

## Licence

Proprietární software. Viz `LICENSE`.


## P3 kapacita a úložiště

`npm run test:capacity` ověřuje 9 000 seed záznamů, 120 souběžných zápisů, atomický soubor, fail-closed obnovu a znovunačtení. Databázová cesta je v `docs/DATABASE-MIGRATION.md`.
