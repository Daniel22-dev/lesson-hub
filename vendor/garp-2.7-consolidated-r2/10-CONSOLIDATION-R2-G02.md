# GARP 2.7 - consolidation r2 / G-02 validator hardening

Date: 2026-09-23
Contract version: GARP 2.7 (this is not GARP 2.8)
Revision: 2026-09-23-r2

## Purpose

Revision r2 closes the policy-admission gap identified as G-02 during the AEGIS E0 review.
The r1 validator accepted the untouched `garp-policy.template.json` because it checked
only non-empty identity strings, non-empty section objects and exact placeholder values.
That allowed `replace-with-app-id`, `0.0.0` and ten `mode=explicit-app-policy` sections
to receive a contract PASS.

## Changes

1. `MASTER/TOOLS/validate-policy.mjs`
   - validates `appId` against a trusted inventory;
   - uses the bundled `MASTER/INVENTORY/ecosystem-apps.json` by default and supports
     an explicit `--inventory` override;
   - rejects forbidden production placeholder versions including `0.0.0`;
   - requires semantic policy fields for every required section, not merely a non-empty object;
   - detects placeholder substrings such as `replace-with`, `change-me` and angle-bracket tokens;
   - rejects the template sentinel `explicit-app-policy`;
   - validates semantic version syntax.

2. `MASTER/CONTRACTS/garp27-core.json`
   - revision bumped to r2;
   - semantic-key admission contract added for all ten required policy sections;
   - placeholder substring rules and forbidden app versions added.

3. `MASTER/INVENTORY/ecosystem-apps.json`
   - explicit GHRAB application inventory added for policy identity admission.

4. `MASTER/TOOLS/contract-selftest.mjs`
   - adds negative G-02 tests for untouched template, unknown appId, zero version,
     mode-only sections and placeholder substrings;
   - positive policy admission still has to pass.

## Compatibility and trust boundary

This change intentionally makes policy admission stricter. Existing app policies that relied on
`mode=explicit-app-policy` without semantic content must be migrated before they can pass r2.
This is a fail-closed compatibility break by design and is the remediation requested by G-02.

The school-server implementation remains `DEFERRED_BY_OWNER_DECISION`. This revision changes
local/CI contract validation only and does not claim LIVE runtime validation.

## Acceptance status

G-02 is technically closed in this reference master when the r2 package and contract selftests pass.
G-01 is separate: formal owner acceptance of the normative GARP authority is not self-issued by this
technical patch and remains an explicit governance action.
