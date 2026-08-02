# Oprava GitHub QA — Lesson Hub 1.1.6

Verze 1.1.6 vznikla z kompletního logu GitHub Actions běhu `83390196277`.

## Skutečná příčina sedmi kritických selhání

Kritické scénáře používají důvěryhodné testovací kroky ve tvaru:

```js
() => { location.hash = '#/academic'; }
```

Node Playwright dostával tento text přímo do `page.evaluate()`. Tím se funkce pouze vytvořila a vrátila, ale nespustila. Trasa se tedy nezměnila a sedm scénářů pokračovalo na nesprávné stránce.

Oprava zavádí explicitní vykonání funkčních výrazů v:

- `scripts/qa-critical-playwright.mjs`,
- `scripts/qa-visual-playwright.mjs`,
- `tools/qa_browser_common.py`.

## Headless smoke test

Headless test dříve otevíral lokální HTTP adresu bez parametru `qa=1` a zároveň nečekal na dokončení asynchronního renderu. Verze 1.1.6:

- přidává lokální QA parametr pouze do testovací adresy,
- čeká na `ghrabAccess=granted`,
- čeká na odstranění `aria-busy`,
- ověřuje `data-rendered-route` proti aktuální hash trase,
- při selhání vypíše konkrétní diagnostiku.

## Další stav

- `npm audit` v reálném běhu 1.1.5 skončil `found 0 vulnerabilities`; override `brace-expansion` 5.0.8 zůstává zachován.
- kritická brána nově vypisuje každý nález přímo do logu GitHub Actions, takže při případné další chybě není nutné nejprve stahovat artefakt.
