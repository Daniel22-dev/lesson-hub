## 1.2.9 — sjednocení reportéru (2026-08-13)

- Reportér používá dvoukrokové vytvoření a skutečné stažení diagnostického ZIPu; Gmail je dostupný až po kliknutí na stažení.
- Rozhraní i e-mail vyžadují ruční přiložení ZIPu a pomocné video je bezpečně skryté uvnitř reportéru i při scrollování.
- Regresní sada fyzicky ověřuje stažený ZIP, jeho snímky a diagnostiku, jednu instanci reportéru, motivy, mobilní zobrazení a klávesnici.
- Plánování hodin, lokální data a volitelný server nebyly změněny; PWA cache je `ghrab-lesson-hub-v1.2.9`.

## 1.2.8 — P5 (2026-08-05)


## 1.2.8 — P5 R2

- Hesla v request cestách používají asynchronní scrypt.
- Po atomickém rename se synchronizuje adresář.
- Lokální pilot zůstává primárním testovacím režimem; server je jen připraven.


- Předprodukční akceptace bez povinného školního serveru.
- Nulové otevřené automatické a11y nálezy jsou podmínkou P5 brány.
- Přidán aktualizovaný release-acceptance kontrakt a odložený GitHub upload.

# Changelog

## 1.2.6 — P4 FINAL (2026-08-04)

- Finální certifikace, čisté buildy, přístupnost, výkon, bezpečnost a release evidence.
- Přidána povinná `qa:p4:ci` brána.

## 1.2.5 - 2026-08-04 (P3)

- Platforma 1.1.0, pristupnost, performance budgety a modularizace P3.

## 1.2.4 — P2: sjednocení platformy GHRAB (2026-08-04)

- jeden kanonický školní logotyp a jednotná autorská patička;
- GHRAB Platform 1.0.0: motiv, storage namespace s vratnou migrací, Studio Bridge 2.0 a artifact envelope v1;
- jednotný název PWA cache `ghrab-lesson-hub-v1.2.4` a řízená aktualizace;
- platformní konformitní test je součástí buildu a CI.


## 1.2.3 — P1 (2026-08-04)

- Produkční bezpečnost, serverový profil, datové manifesty a jednotná observability vrstva.
- AI Core: not-applicable; společná serverová platforma bez AI transportu.

# Changelog

## 1.2.2 — 2026-08-04

- Etapa P0: start aplikace i manuálu používá konfigurovatelný deployment kontrakt, reportér je best-effort a service worker respektuje no-store bezpečnostní zdroje.
## 1.2.1 — 2026-08-03

- sjednocen reportér v běžném i lokálním QA spuštění;
- odstraněna závislost bootstrapu na pevné externí GitHub URL ve prospěch centrální cesty `/AI-Studio-GHRAB/`;
- přidána živá synchronizace motivu, ochrana konceptu, ZIP/Gmail workflow a PWA precache;
- lokální manuál nyní odkazuje na centrální návod bez druhé instance reportéru.
