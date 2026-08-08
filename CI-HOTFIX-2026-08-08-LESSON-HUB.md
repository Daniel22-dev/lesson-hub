# Lesson Hub CI hotfix – 2026-08-08

This hotfix addresses the GitHub Actions failures observed for Lesson Hub 1.2.8.

- raises light-theme text/accent/success contrast for the exact axe-core 4.12.1 findings;
- fixes canonical school-logo URLs in the runtime and interactive manual;
- makes the local QA static server explicitly emulate the central AI Studio guard/config endpoints for visual, critical and headless browser gates;
- leaves production access control unchanged; the access emulation is enabled only by QA callers through `qaAppId`.


## H2 — final scenario harness stabilization

- Critical and Visual QA clicks now dispatch against the current DOM node, avoiding Playwright stale-handle failures when Lesson Hub intentionally re-renders during async actions.
- Visual scenarios wait for the initial route render (`#app[data-rendered-route]`, no `aria-busy`) before interacting.
- Server-page QA expectation was aligned with the current shipped heading `Server a synchronizace`.
- This targets the final GitHub `qa:release` failure from run logs_84837494132; axe, Technical, Security, PWA, combinatorial and headless were already green in that run.
## Final visual QA stabilization
- standalone manual waits for `#manual-app` instead of the SPA-only `#app`;
- visual actions wait for the current route render to settle;
- final visual contracts wait for expected text and required visible selectors;
- if a late async rerender consumes the opening click, the last repository-owned click is replayed once after the route is stable.

