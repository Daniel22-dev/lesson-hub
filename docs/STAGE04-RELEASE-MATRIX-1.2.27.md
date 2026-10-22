# Lesson Hub 1.2.27 – release identity checklist (Stage 04)

Source of truth: `main@c2cfcc457acf81898522cb63cfb09446504d01ea` / 1.2.26. Proposed version 1.2.27, **not yet issued**.

This is a pre-release checklist, not a permission to publish. No production metadata should be changed until the integration and tests pass.

## Files with confirmed 1.2.26 references on main

| File | What must be updated when the actual release is cut |
| --- | --- |
| `package.json`, `package-lock.json` | Package version / lockfile root version |
| `src/core/release.js` | App release version |
| `src/config/release-acceptance.json`, `public/config/release-acceptance.json` | Matching appVersion and evidence |
| `public/manifest.webmanifest` | App version / cache name, preserve any/maskable |
| `public/sw.js` | Cache name and safe upgrade behavior |
| `ghrab-platform.consumer.json`, `public/ghrab-platform.consumer.json` | App version and matching cache name |
| `studio/app-manifest.template.json` | Cache name; runtime __APP_VERSION__ substituted at build |
| `qa/qa-manifest.json` | appVersion and all versionChecks |
| `src/config/data-manifest.json` | appVersion; verify public copy consistency |
| `security/garp27/application-migration-profile.json` | appVersion + release identity, keep controlled provenance |
| `CHANGELOG.md`, `README.md`, `public/manual/index.html` | Actual release notes, user guidance / copy |
| `public/config/platform-manifest.json`, `src/config/deployment.json` | Inspect exact release references before issuing |
| `public/config/release-acceptance.json`, CI provenance | Replace only from verified release evidence |

## Non-negotiable gates

- Verified Stage04 source code must exist **on the PR branch**. Today only release documentation is committed; do not attempt an empty release.
- `test:canonical-groups` + full `npm test`, `npm run check`, clean `npm run build`, `npm run qa:quality`, `npm run qa:p5:ci`, `npm run qa:garp27:static`, `npm run verify:platform` PASS on exact current SHA.
- `distBytes <= 1225000` on *real current build*. Last PASS CI for 1.2.26: 1218757 bytes; do not silently relax the budget.
- Browser multi-tab IndexedDB CAS, archive/rename/unlink, rollover, offline and safe backup merge scenarios PASS. No student identities read by Stage04.
- Update `security/garp27/trust-anchor.json` **only if the verified canonical contract digest actually changes**. Never fabricate a signature or checksum.
- Standard protected candidate → Safe Promotion → main → Pages → Studio registry chain with SHA parity proof.
- Until all gates pass: **DRAFT, NO MERGE, NO DEPLOY**.
