# GARP 2.7 - consolidated master r2

This directory is the reference implementation core for revision `2026-09-23-r2`.
It is not GARP 2.8. The active contract version remains **GARP 2.7**.

## r2 change

r2 closes the G-02 policy-validator gap found during AEGIS E0. Policy admission now requires:

- inventory-valid `appId`;
- admissible semver `appVersion` and no forbidden `0.0.0` production placeholder;
- non-empty required policy sections;
- at least one recognized semantic field in every required section;
- no exact or substring placeholder tokens such as `explicit-app-policy`, `replace-with`,
  `change-me`, `TBD`, `example`, `unknown` or `<...>`.

The bundled inventory is `MASTER/INVENTORY/ecosystem-apps.json`. A trusted alternative may be
passed explicitly with `--inventory`.

## Server status

Active school-server preparation is **DEFERRED_BY_OWNER_DECISION**. The package does not claim
LIVE validation. Server-dependent tests must return `NOT_TESTED`/`DEFERRED`, never PASS.
Local and CI protections remain active.

## Exit codes

- `0` - PASS in the declared test scope.
- `1` - security/contract FAIL.
- `2` - HARNESS_ERROR; never PASS.
- `3` - NOT_TESTED / DEFERRED; never translate to LIVE PASS.

## Run

```bash
node MASTER/TOOLS/package-selftest.mjs
node MASTER/TOOLS/contract-selftest.mjs
node MASTER/TOOLS/validate-policy.mjs POLICY.json --core MASTER/CONTRACTS/garp27-core.json
```

`validate-policy.mjs` uses the bundled inventory by default. For an externally versioned trusted
inventory, pass `--inventory PATH`.

`PACKAGE_SELFTEST` checks package/contract consistency. `CONTRACT_TEST` verifies reference
validators against synthetic positive and negative cases, including G-02. Neither is an
APP_BEHAVIOR_TEST or LIVE_TEST for a deployed application.
