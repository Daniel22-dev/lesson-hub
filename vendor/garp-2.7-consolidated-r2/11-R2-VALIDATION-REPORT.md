# GARP 2.7 r2 validation report

Date: 2026-09-23
Revision: 2026-09-23-r2

## Result

- PACKAGE_SELFTEST: 19/19 PASS.
- CONTRACT_TEST: 25/25 PASS.
- G-02 dedicated negative contract cases: 5/5 PASS.
- Untouched policy template: correctly rejected with exit code 1.
- Inventory-valid semantic `correspondence` positive fixture: accepted with exit code 0.
- JSON/package consistency checks: 9/9 PASS before final checksum generation.
- Current Korespondencni asistent GARP 2.7 policy shape was inspected and is compatible
  with the r2 semantic-key contract; this is a structural compatibility check, not LIVE evidence.

## G-02 closure

The r1 false-PASS path is closed in the reference validator. A policy cannot receive PASS merely
because identity strings are non-empty and each required section contains a `mode` property.

The r2 validator now fails closed on:

1. appId absent from trusted inventory;
2. forbidden appVersion `0.0.0`;
3. invalid semantic-version syntax;
4. required sections without recognized semantic content;
5. exact placeholder sentinels including `explicit-app-policy`;
6. placeholder substrings such as `replace-with`, `change-me`, `example`, `unknown`, `TBD`;
7. angle-bracket placeholder tokens such as `<app-id>`.

## Scope boundary

This report verifies the reference package and validator contract. It does not certify a deployed
application and does not create a LIVE PASS. School-server dependent controls remain
DEFERRED_BY_OWNER_DECISION.

G-01 remains separate: formal acceptance of the normative GARP authority must be recorded by the
project owner/governance process. The technical patch does not self-approve its own authority.
