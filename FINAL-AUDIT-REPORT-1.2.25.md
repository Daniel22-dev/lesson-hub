# Lesson Hub 1.2.25 — závěrečný clean-up a audit

Datum: 2026-09-26

## Rozsah

Audit pokryl zdrojový kandidát Lesson Hub 1.2.25 po migraci na GARP 2.7 r2 G-02 FIX, release workflow, dokumentaci, GARP 2.7 aplikační kontrakty, zachované GARP 2.5.1/N5 regresní kontroly a lokálně reprodukovatelné testy.

## Clean-up

- README byl opraven z neaktuálního označení Platform stage P3 na skutečný stav P5.
- Historická QA sekce 1.2.22 byla výslovně označena jako auditní stopa, aby nepůsobila jako aktuální release stav.
- `UPLOAD-CHECKLIST.md` byl přepsán z neplatného postupu pro 1.2.3 na současný model `candidate → Safe Promotion / PR → main → verified Pages release`.
- Generované `qa-results/`, `dist/`, `dist-pages/`, `dist-school-server/`, `audit-evidence/` a případný `node_modules/` nejsou součástí čistého zdrojového balíku.
- Historické GARP 2.5.1 evidence 1.2.22 byly ponechány záměrně jako auditní stopa; nejsou vydávány za aktuální GARP 2.7 důkaz.
- `security/garp27/architecture-policy.json` již neobsahuje doslovné private-key PEM signatury. Signatury jsou uloženy jako fragmenty a architektonický gate je skládá při kontrole, takže canonical secret scanner zůstává fail-closed a současně se nespouští na vlastní policy.
- `qa-security` neaplikuje heuristiku nechráněného `localStorage` na explicitní test harnessy; runtime soubory zůstávají kontrolované. Tím bylo odstraněno 30 nerelevantních MINOR warningů bez oslabení runtime kontroly.

## Závěrečné výsledky

| Kontrola | Výsledek |
|---|---|
| `npm run check` | PASS — verze 1.2.25 synchronizována |
| `npm run build` | PASS |
| `npm run qa:technical` | PASS — 0 nálezů |
| `npm run qa:security` | PASS — 0 nálezů |
| `npm run qa:xss` | PASS |
| `npm run qa:garp25:pinned` | PASS |
| `npm run qa:garp25:secrets` | PASS — 0 reálných nálezů, synthetic canaries zachovány |
| `npm run qa:safe-promotion` | PASS |
| `npm run qa:auto-patch-topology` | PASS |
| `npm run qa:garp27:static` | PASS |
| `npm run qa:garp27:foundation` | `FOUNDATION_PASS_LIVE_NOT_TESTED`, 14/14 kroků PASS |
| `npm test` | PASS |
| JS/MJS syntax validation | PASS |
| JSON parse validation | PASS |

`npm test` korektně uvádí browser suite jako `NOT_TESTED`, protože lokální managed Chromium má URLBlocklist pro lokální testovací stránky. Tento stav není prezentován jako PASS a musí jej pokrýt CI/E2E prostředí bez této politiky.

## Dependency / SCA omezení lokálního prostředí

Čerstvé `npm ci --ignore-scripts` se v pracovním kontejneru nedokončilo kvůli nedostupnosti npm registru a skončilo timeoutem. Vzniklý neúplný `node_modules` byl odstraněn a nebyl použit jako důkaz. Proto se z lokálního běhu **nedeklaruje SCA PASS**. GitHub Actions musí provést čistý `npm ci` / audit a je pro promotion blokující.

## LIVE / server

School-server GARP 2.7 LIVE stav zůstává `NOT_TESTED` / `DEFERRED_BY_OWNER_DECISION`. Lokální FOUNDATION PASS není serverové produkční schválení a neověřuje reverse proxy, produkční filesystem boundary, centrální monitoring/orchestrace ani live recovery.

## Verdikt

Zdrojový kandidát Lesson Hub 1.2.25 je po clean-upu a lokálním závěrečném auditu konzistentní a připravený pro `candidate` a GitHub CI. Promotion do `main` smí následovat až po zelených required checks a ověření exact release identity.
