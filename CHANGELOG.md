## 1.2.12 — 2026-08-27

- Hotfix synchronizuje `sharedAccessVersion` s aktuální podepsanou konfigurací AI Studia, aby se aplikace po bezpečnostní rotaci nezamykala kvůli `configuration-version-mismatch`.
- Pedagogické funkce a datové formáty se nemění.

## 1.2.11 — GARP opravy po Claude kole 1 (2026-08-27)

- Blokovány samostatné identifikátory __proto__/prototype/constructor a serverové resource mapy převedeny na null-prototype objekty.
- URL validace rozšířena o běžné aliasy a hodnotovou blokaci spustitelných schémat bez omezení běžného textu typu „Data: …“.
- Veřejná GitHub Pages CSP používá connect-src 'self' bez localhost výjimek; frame-ancestors zůstává pravdivě vynucováno jen HTTP hlavičkou školního profilu.
- Učitel už nemůže endpointem process-due spustit odesílání zpráv jiných uživatelů; globální režim zůstává vlastníkovi/správci a serverovému scheduleru.
- Doplněny regrese pro C1–C3 a cross-user message processing.

## 1.2.10 — GARP bezpečnostní kandidát (2026-08-26)

- Lokální QA administrátorský permit je nyní omezen na localhost/loopback nebo `about:`; veřejná URL s `?qa=1` již nemůže obejít centrální Access Guard.
- Import záloh, vzdálená synchronizace a serverové resource payloady mají společnou strukturální validaci nedůvěryhodných dat včetně blokace prototype-pollution klíčů, nebezpečných ID/tokenů a URL protokolů.
- GitHub Actions jsou připnuté na neměnné commit SHA a auditní regrese odmítne návrat plovoucích `@vN` značek.
- Doplněny regrese pro QA bypass, checksummed škodlivý import, škodlivou serverovou synchronizaci, nebezpečný serverový URL payload a prototype-pollution payload.
- Statický GitHub Pages profil nyní skutečně vynucuje CSP přes `<meta http-equiv>`; spouštění skriptů spadá pod `default-src 'self'` a nepovoluje `unsafe-inline` ani `unsafe-eval`. Zůstává pouze přesně zdokumentovaná stylová výjimka `style-src 'unsafe-inline'` pro access-gate styly.
- PWA cache je `ghrab-lesson-hub-v1.2.10`; distribuovaná verze je sjednocena na 1.2.10.

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
