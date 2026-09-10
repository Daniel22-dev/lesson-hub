# Lesson Hub 1.2.22

**Aktuální verze:** 1.2.22  
**Platforma:** GHRAB Platform 1.1.2 · etapa P3


Lesson Hub je local-first osobní paměť učitele v ekosystému AI Studio GHRAB. Pro běžné pilotní používání **nepotřebuje server**: data ukládá do IndexedDB v prohlížeči a nabízí export, import i lokální body obnovy.

Serverová část je v repozitáři připravena pro budoucí školní nasazení, ale ve výchozím stavu není připojena, synchronizace je vypnutá a e-mailová brána je zakázaná.

## Integrace s AI Studiem GHRAB

Verze 1.2.22 je kandidát pro koordinovanou release wave AI Studia GHRAB a používá GHRAB Platform 1.1.2 se suite-session lifecycle kontraktem. Build publikuje `studio-manifest.json`, hlavní aplikaci i manuál chrání společný Access Guard, Studio Bridge přijímá pouze anonymní materiály `ghrab-material-v1` a pilotní telemetrie ukládá jen povolené technické počty bez obsahu výuky.

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

Verze 1.2.22 zachovává ověřené opravy z předchozího vydání a staví na zeleném běhu GitHub Actions:

- funkční kroky `evaluate` se nyní v Node Playwrightu i Python fallbacku skutečně vykonají; dříve se pouze vytvořil objekt funkce, takže se hash trasa nezměnila,
- headless smoke test používá explicitní lokální QA přístup a čeká na dokončený render požadované trasy.

Zachovány zůstávají předchozí opravy hashových cest, dynamického dnešního data, vizuálního reportéru a čekání na asynchronní render. Lockfile zůstává minimální a QA v 1.2.22 navíc odmítá userinfo, query, fragment, percent-encoding i alternativní port v `resolved` URL. Kanonický secret scanner zachycuje i lowercase nekotovaná tajemství v YAML/INI/.properties/Compose/env formátech.

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

Pokud je zapnuta centrální GHRAB gateway, `LESSON_HUB_GHRAB_UPSTREAM_SECRET` generujte CSPRNG (doporučeně `openssl rand -hex 32`); shape kontrola je pouze fail-closed guard, ne měření skutečné entropie. Gateway hlavička nesmí přidělit `owner/admin`, SSO účty jsou pouze `teacher/substitute`, používají kanonický ASCII e-mail a jsou gateway-only bez lokálního hesla. Offboarding SSO znamená účet zakázat. Reverse proxy/gateway musí před vložením vlastních `x-ghrab-*` hlaviček odstranit stejnojmenné klientské hlavičky.

Automatické serverové snapshoty jsou ve výchozím stavu vypnuté. Server při startu i v provozním centru zobrazí výrazné varování, dokud není nastaveno `LESSON_HUB_BACKUP_ENABLED=true`.

## GARP 2.5.1 SHIELD-PREP

Verze 1.2.22 navazuje na PREP release-integrity/supply-chain evidenci z 1.2.18 a fail-closed ochranu service workeru pro bezpečnostně kritické assety. Stav **není school-server production approval**: browser/served DAST, online advisory SCA, produkční key custody a SHIELD-LIVE zůstávají oddělenými podmínkami. Protokoly a strojově čitelné podklady jsou v `security/`.

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
