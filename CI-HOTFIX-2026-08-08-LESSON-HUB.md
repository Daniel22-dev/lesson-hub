# Lesson Hub CI hotfix – 2026-08-08

This hotfix addresses the GitHub Actions failures observed for Lesson Hub 1.2.8.

- raises light-theme text/accent/success contrast for the exact axe-core 4.12.1 findings;
- fixes canonical school-logo URLs in the runtime and interactive manual;
- makes the local QA static server explicitly emulate the central AI Studio guard/config endpoints for visual, critical and headless browser gates;
- leaves production access control unchanged; the access emulation is enabled only by QA callers through `qaAppId`.
