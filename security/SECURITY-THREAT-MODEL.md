# Lesson Hub 1.2.22 — GARP 2.5.1 SHIELD-PREP Threat Model

Datum: 2026-09-10  
Profil: PREP regular hardening, nikoli school-server production approval  
AGENTIC: NO · AI-enabled: NO

| ID | Hranice | Riziko | 1.2.22 kontrola / reziduum |
|---|---|---|---|
| TB-01 | browser → Access Guard | bypass/stale access | existující fail-closed guard; LIVE revokace NT |
| TB-02 | browser → IndexedDB/localStorage | residue/tampering/data loss | suite-session/persistence guard; N6/LH-D27 OPEN |
| TB-03 | Gateway → backend | forged identity/role/secret | N15/N23–N25 zachovány; JWS/mTLS LIVE NT |
| TB-04 | import/restore → state | pollution/executable URL/oversize | existující strukturální validace a limity |
| TB-05 | source/dependency/CI → build | hidden secret/key, lock injection, CI remote execution | N29 lowercase config secret detection; N26 bounded literal folding; N27 PowerShell remote execution policy; N28 canonical registry port; fresh 1.2.22 SCA pending independent registry run |
| TB-06 | service worker → critical assets | stale security control | network-only/no-store + checker; N12 future path OPEN |
| TB-07 | build → school deployment | tamper/mixed/source ambiguity | RI+Ed25519+deterministic build+exact source SHA; LIVE custody/registry NT |
| TB-08 | Pages workflow → public dist | unsigned real distribution | N8/LH-D29 OPEN |

## Secret/config policy
Source i deployment používají stejné kanonické secret-scan jádro. Vedle private-key reprezentací se kontrolují i realistické lowercase secret assignments v YAML/INI/.properties/Compose/env. Obvious placeholder/reference hodnoty se nevydávají za tajemství. Bounded static folding zachytí některé zjevné runtime-obfuscated literal patterns; obecné dynamické skládání zůstává známým limitem statické analýzy.

## Gateway identity policy
Shared secret autentizuje gateway, ne jednotlivé uživatelské assertion. Interim PREP policy proto drží privilegované role local-only, canonical e-mail SSO identifiers, gateway-only SSO bez local password a bounded expiry. LIVE stále vyžaduje signed identity/JWS s audience+expiry nebo mTLS/equivalent trust.

## Otevřená nejvyšší rezidua
N8/LH-D29, N9/LH-D30, N6/LH-D27 + LH-D01, N12, browser/DAST/TLS/proxy, backup lifecycle, production key custody, signed registry/identity, watchdog.
