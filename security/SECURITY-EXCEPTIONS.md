# Lesson Hub 1.2.22 — Security exceptions / debt register

## Stav kola

1.2.22 je běžné hardening kolo po Claude auditu 1.2.21. Audit dovolil 1.2.21 ponechat jako aktuální PREP stav, uzavřel N20–N25 a otevřel N29 (MEDIUM), N26/N27/N28 (LOW) a metadata poznámku k `baseCommit`. Žádný lokální výsledek 1.2.22 se sám nepovyšuje na LIVE.

## 1.2.22 remediation — k nezávislé reprodukci

- N29: kanonické sdílené secret-scan jádro nyní detekuje nekotované lowercase secret hodnoty v YAML, INI, `.properties`, Docker Compose environment seznamech a env-style souborech; placeholdery a reference na proměnné jsou filtrovány.
- N26 LOW: bounded statická detekce skládá zjevné pole řetězcových částí zakončené `.join("")` pro private-key material a rozpoznává literal `String.fromCharCode(...)` / `btoa("user:password")` credential patterns. Obecně dynamicky vypočtená tajemství zůstávají limitem statické analýzy.
- N27 LOW: workflow policy zakazuje PowerShell `iwr|iex` i `Invoke-WebRequest|Invoke-Expression`.
- N28 LOW: lock gate odmítá alternativní/noncanonical port v `resolved` URL.
- source-tree manifest má nést `baseCommit=5dc8db114561c0d3696e71003eb1a1d71c7e846c`; exact source identity je i nadále SHA-256 frozen source ZIPu, ne tento historický commit.

## Otevřené dluhy, které 1.2.22 nepovyšuje

- LH-D01 / SIM-01 — shared-origin isolation: OPEN.
- LH-D27 / N6 — suite cleanup / availability risk: OPEN.
- LH-D29 / N8 — GitHub Pages mimo podepsaný school-server RI řetězec: OPEN.
- LH-D30 / N9 — nepodepsaný produkční release registr: OPEN.
- N12 — budoucí Integrity Service / service-worker path design: OPEN.
- LIVE hardening: podepsaná gateway identita JWS/mTLS, produkční key custody, trusted builder, watchdog, served DAST/TLS/headers: NOT TESTED.

## SCA

Claude 1.2.21 nezávisle doložil fresh `npm ci --ignore-scripts`, čistý `npm ls`, online `npm audit` 0 vulnerabilities a SBOM coverage PASS pro exact 1.2.21 snapshot. To je historická evidence 1.2.21. 1.2.22 musí mít vlastní fresh registry-backed běh; bez něj se SCA pro nový snapshot nepřebírá jako PASS.

## Data / production

Reálná studentská data: NEPOVOLENO. School-server production: NE. RI-PREP může být GREEN, ale RI-LIVE/SHIELD-LIVE zůstávají NOT TESTED.
