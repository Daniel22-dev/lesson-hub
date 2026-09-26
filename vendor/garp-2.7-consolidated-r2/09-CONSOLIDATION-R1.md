# GARP 2.7 — konsolidace r1 (2026-09-23)

Tato revize **není GARP 2.8**. Nahrazuje předchozí konsolidační balík jako pracovní
master pro migraci aplikací.

## Uzavření A-01 až A-07

- **A-01:** `validate-assurance.mjs` odvozuje celkový stav z povinných komponent,
  vyžaduje jedinečné komponenty, čerstvou a důvěryhodnou evidenci a odmítá
  rozporný deklarovaný PASS.
- **A-02:** `validate-auto-patch.mjs` vyžaduje neprázdnou úplnou sadu gate IDs z
  externího trust profilu; missing/empty/N/A mimo explicitní povolení blokuje admission.
- **A-03:** COMMITTED je vázán na externě očekávanou identitu cíle, allowlist zdroje,
  SHA-256 policy/artefaktu, sekvenci/replay vazbu a důvěryhodné evidence digesty.
- **A-04:** aktuální validátory mají jednoznačné povinné atributy a sémantické
  kontroly; prázdné kritické policy sekce, false LIVE PASS a neúplné gates jsou FAIL.
- **A-05:** aktuální master je explicitně `garpVersion=2.7`; 2.5/2.6 jsou pouze
  historické baseline a nepřijímají se tiše jako nový 2.7 kontrakt.
- **A-06:** podmíněný produkční test je strojově vázán na environment, schválení,
  allowlisted dedicated sink a limity; nesplnění vrací `NOT_TESTED` (exit 3).
- **A-07:** selftesty nesou explicitní klasifikaci `PACKAGE_SELFTEST`/`CONTRACT_TEST`
  a výslovně uvádějí, že nejsou APP_BEHAVIOR_TEST ani LIVE_TEST.

## Serverová fáze

Na rozhodnutí vlastníka je aktivní příprava školního serveru odložena. Master pouze
udržuje hranici: server-dependent body = `DEFERRED/NOT_TESTED`. Lokální a CI
bezpečnostní brány zůstávají plně aktivní. Konkrétní serverové podklady se začnou
připravovat až po případném souhlasu vedení a následném doplnění požadavků správce.

## Rollout

1. Re-baseline první referenční aplikace LUDUS proti této konsolidaci.
2. Migrovat druhou odlišnou aplikaci (KS) podle stejného masteru.
3. Porovnat výjimky, duplikace a cross-app tok.
4. Teprve poté použít 2.7 jako sériový standard pro zbytek ekosystému.
