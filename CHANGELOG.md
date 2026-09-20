## 1.2.24 — end-to-end auto-patch validation release (2026-09-20)

- technical PATCH-only validation release; no pedagogical/client feature behavior is intentionally changed;
- exercises the enrolled production chain candidate → P5/GARP/N5 → protected main → Pages → live release verification → app-updated → AI Studio auto-patch;
- retains the 1.2.23 Safe Promotion, exact release identity and TRANSITIONAL assurance model unchanged.

## 1.2.23 — Safe Promotion + enforced GARP/N5 + exact Pages release identity (2026-09-20)

- production `main` is no longer the normal update entrypoint; the target flow is durable `candidate` → P5/GARP/N5 → PR → protected `main` → main P5 → deploy;
- full `qa:garp25:static` is wired into non-PR P5/release execution instead of existing only as prepared tooling; N5 selftest remains permanent and currently covers 98/98 checks;
- GitHub Pages deployment is accepted only from a successful P5 run over `main`; candidate and unverified PR heads cannot deploy;
- deployment is fail-closed when `AI_STUDIO_DISPATCH_TOKEN` is unavailable, and `app-updated` is emitted only after bounded live verification;
- Pages releases publish `ghrab-release-integrity-v2` binding app/version/source commit/artifact digest/manifest/SBOM/provenance/security evidence; unsigned state is explicitly `TRANSITIONAL`;
- Platform 1.1.2 manifest post-processing now merges the existing Studio contract instead of replacing it, preserving `requiredPlatformRange`, `storagePrefix`, `studioBridge` and `artifactEnvelope`;
- redundant legacy P3/P4 GitHub workflows were removed; their former entrypoints were already delegated to P5 R2;
- control-class regression fixtures were updated to the new workflow topology without weakening the negative controls;
- no pedagogical/client feature behavior is intentionally changed.

## 1.2.22 — GARP 2.5.1 SHIELD-PREP regular hardening after Claude round 4 (2026-09-10)

- N29: canonical source/deployment secret scan detects unquoted lowercase secret assignments in YAML/INI/.properties/Compose/env formats while excluding obvious placeholders and environment references.
- N26 LOW: scanner adds bounded static folding for obvious split private-key literals, String.fromCharCode token literals and btoa Basic-auth literals.
- N27: workflow policy rejects PowerShell iwr/Invoke-WebRequest piped to iex/Invoke-Expression.
- N28: lock gate rejects noncanonical alternate ports in registry resolved URLs.
- source-tree manifest evidence now records historical Git baseCommit explicitly while exact source identity remains the frozen ZIP SHA-256.
- No pedagogical/client runtime behavior changed. PREP remains distinct from LIVE.

## 1.2.21 — GARP 2.5.1 SHIELD-PREP regular hardening after Claude round 3 (2026-09-10)

- N20: canonical secret scanning now recursively inspects bounded base64/base64url and hex encodings and ZIP/JAR containers; unsupported/ambiguous archives fail closed. Canonical selftest includes recoverable double-base64 PEM, hex PKCS#8 DER and ZIP-contained private-key controls.
- N21: workflow policy blocks remote process substitution (`<(curl|wget)`), sourcing process substitution and `eval` in workflow run blocks, closing the two independent review bypasses.
- N22: lock audit rejects userinfo, query, fragment and percent-encoded package paths in `resolved` URLs; regression matrix covers all four cases.
- N23: gateway-secret policy explicitly requires CSPRNG generation and rejects obvious repeated patterns; shape checks remain only a deployment guard, not an entropy proof.
- N24: GHRAB SSO email identities must be canonical ASCII addresses; plus-tag, trailing-dot and Unicode/confusable variants are rejected instead of creating duplicate SSO identities.
- N25: GHRAB SSO accounts are gateway-only and cannot receive a local password; offboarding is performed by disabling the SSO account.
- QA hygiene: the legacy heuristic `qa:security` treats only the canonical GARP selftest as an explicit secret fixture; it remains WARN on 30 localStorage test-harness observations and is not represented as full SAST PASS.
- N6, N8, N9, N12 and LH-D01 remain explicit PREP/LIVE debts. No pedagogical, AI-provider, client storage or client network capability is added.

## 1.2.20 — GARP 2.5.1 SHIELD-PREP regular hardening after Claude round 2 (2026-09-10)

- N15: upstream gateway secrets must use a high-entropy 256-bit shape; SSO identities cannot be promoted to `owner`/`admin`, legacy privileged SSO records fail closed on upstream authentication, and SSO/local e-mail collisions are rejected.
- N16: source and deployment secret scanning now share one canonical GARP rule engine; the B01-B15 bypass class is covered by canonical selftest and no private-key material is allowlisted.
- N17: lock QA verifies package.json/root-lock equivalence, full registry package paths, SHA-512 integrity and absence of extraneous entries; class regressions cover L3/L4/L6.
- N18: GitHub workflow policy is parsed structurally; top-level permissions are exact read-only, write scopes are restricted to the deploy job, `pull_request_target` and remote download-to-shell execution are rejected, and action/runner/Node pinning remains enforced.
- N19: frozen source identity is bound by sourcePackageSha256; the historical Git commit is recorded only as `baseCommit`, not as a claim that checkout(baseCommit) equals the 1.2.20 source snapshot.
- Claude 1.2.19 independent SCA evidence is recorded as historical evidence; 1.2.20 still requires its own fresh SCA run for promotion beyond PREP.
- N6, N8, N9 and N12 remain explicit PREP/LIVE debts and are not silently promoted.
- Pedagogical workflows, AI scope and client data formats are unchanged.

## 1.2.19 — GARP 2.5.1 SHIELD-PREP remediation po Claude DELTA auditu (2026-09-10)

- serverová gateway konfigurace je fail-closed pro nastavený prázdný, krátký nebo placeholder upstream secret; nový regresní test reprodukuje a blokuje původní PoC;
- nepodepsaná `x-ghrab-user-roles` hlavička už nemůže vytvořit `owner`/`admin`; privilegované role zůstávají pouze serverově spravované a upstream expiry je bounded;
- lockfile je čistě přegenerován z deklarovaných závislostí, bez extraneous stromu a falešného `type-check@0.6.0`; `qa:lock` kontroluje dosažitelnost i verzi resolved tarballu;
- CycloneDX evidence je rozdělena na development SBOM a deployment SBOM; vývojové npm balíčky jsou `excluded`, deployment SBOM zahrnuje vendorovanou GHRAB Platform 1.1.2 a GHRAB Error Reporter 1.1.2;
- secret scan již nepovoluje testově pojmenované soubory v nasazovaných `src/` cestách a detekuje JWK private `d`, encrypted/DSA/PGP private-key formy; deployment leak scanner obsahuje stejné relevantní kontroly;
- GitHub Pages `pages: write` a `id-token: write` jsou omezeny pouze na deploy job; QA job má jen `contents: read`;
- otevřené N6/N8/N9 jsou vedeny jako explicitní PREP/LIVE dluhy; provenance používá skutečné časy a základní commit, PREP registry nevymýšlí schválení 1.2.17;
- pedagogická logika, AI schopnosti a datové formáty se tímto opravným kolem nemění.

## 1.2.18 — GARP 2.5.1 SHIELD-PREP (2026-09-10)

- service worker zachovává bezpečnostně kritické platformní, deployment a release-integrity assety mimo Cache Storage a obsluhuje je pouze přes `networkOnlyNoStore()`;
- build fail-closed filtruje stejné kritické assety z aplikačního i platformního precache seznamu;
- přidána GARP 2.5.1 assurance/tooling vrstva, CycloneDX SBOM, kontrola pinned inputs, secret scan se syntetickou citlivostní kontrolou a fail-closed SW mutační sada;
- GARP změny nerozšiřují pedagogické funkce, AI schopnosti ani síťové destinace; zachovávají Platform 1.1.2 a suite-session/storage hardening z 1.2.17;
- produkční school-server/LIVE schválení tímto PREP kandidátem nevzniká; serverové DAST, provozní TLS/headers, key custody, externí watchdog a další LIVE kontroly zůstávají oddělené.

## 1.2.17 — Platform 1.1.2 CI remediation (2026-09-05)

- opravena kritická regrese editoru hodin: `lessonDialogs.js` znovu definuje bezpečný helper `formValue()`, takže vytvoření/úprava hodiny ani rychlý zápis nekončí `ReferenceError`;
- suite-session browser harness spuštěný přes raw CDP explicitně používá Chromium automation mode, aby na loopback `?qa=1` splnil existující dvojitou podmínku lokálního QA access guardu (`trusted local origin` + `navigator.webdriver`);
- produkční access guard, suite-session cleanup ani storage ownership se touto opravou neuvolňují; Platforma zůstává přesně 1.1.2.

## 1.2.12 — 2026-08-27


## 1.2.15 — GARP 2.3 remediation po Claude kole 2

- autorizace generických resources už nepovažuje uložené `visibility: shared` za samostatné právo; sdílení je při každém čtení vázáno na aktuální allowlist typu resource,
- po každém `store.open()`, včetně `restoreBackup()`, probíhá idempotentní normalizace legacy visibility, sync payloadů, citlivých příloh a auditních metadat,
- legacy `students` a `messages` s historickým `shared` se normalizují na `private`, zatímco legitimní `materials` / `materialLinks` zůstávají sdílené,
- audit neúspěšného přihlášení už neukládá raw e-mail ani nesolený zkrácený SHA-256 `emailHash`; zachovává pouze neidentifikující `accountMatched`,
- regrese pokrývají přímé legacy záznamy i obnovu staré zálohy a ověřují, že oprava nerozbíjí oprávněné shared/substitution materiály.


## 1.2.14 — GARP 2.3 remediation kolo 2

- uzavřena generická cross-user čtecí cesta k `substitution*` záznamům; period-scoped sdílení zůstává pouze ve vyhrazeném substitution API,
- studentské přílohy a řešení jsou serverově private; unscoped `substitution` attachment fail-closed; deduplikace respektuje privacy context,
- mazání `attachmentLinks` používá scrub + sync tombstone i při smazání přílohy a retenčním purge,
- klientská API a binární volání používají `cache: no-store`,
- CI obsahuje explicitní dependency audit a lockfile připíná opravené `brace-expansion 5.0.9` a `undici 7.29.0`,
- rozšířeny GARP regrese, PC-01 evidence a time-manipulation test.

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

## 1.2.13 – GARP 2.3 privacy hardening

- serverově omezuje sdílení generických resource záznamů na explicitně sdílené typy; studentské a komunikační záznamy zůstávají private i při klientském pokusu o `visibility: shared`;
- rozšiřuje regresi o cross-user privacy kontrolu studentských záznamů a zpráv a zachovává legitimní sdílení materiálů;
- synchronizuje release metadata, public consumer a aktivní testovací harnessy na 1.2.13.

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
