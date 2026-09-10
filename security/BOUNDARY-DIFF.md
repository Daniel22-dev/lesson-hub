# Lesson Hub 1.2.22 — GARP 2.5.1 boundary diff

Referenční PREP stav: Lesson Hub 1.2.21, nezávisle ověřený Claude DELTA kolem 4.  
Cíl 1.2.22: běžné hardening kolo N29 + LOW rezidua N26/N27/N28 a metadata `baseCommit`, bez změny pedagogické logiky.

| Otázka | 1.2.22 | Důkaz / dopad |
|---|---|---|
| Změnil se distribuovaný klientský runtime? | NE věcně | Klient, SW, Studio Bridge, import/export a UI mění jen release identitu. |
| Změnil se serverový auth boundary? | NE věcně | N23–N25 zůstávají zachované; 1.2.22 nepřidává serverovou auth schopnost. |
| Změnil se storage/import/export flow? | NE | N6/LH-D27 zůstává otevřený. |
| Změnil se AI/provider/model/tool scope? | NE | AI-enabled=NO, AGENTIC=NO. |
| Změnil se network egress? | NE jako runtime destinace | N27 mění pouze CI policy detekci. |
| Změnil se supply-chain tooling? | ANO | N29 canonical bare-secret config detection; N26 bounded derived-literal detection; N27 PowerShell remote execution; N28 canonical registry-port enforcement. |
| Změnil se Pages distribuční model? | NE | N8/LH-D29 zůstává otevřen. |
| Změnila se RI/source identity semantika? | NE věcně | Exact source = frozen ZIP SHA; historical Git commit = `baseCommit`; source-tree manifest metadata se pouze sjednocuje. |

Pedagogické workflow, lekce/student/materiál datové kontrakty a klientské síťové destinace se v 1.2.22 věcně nemění.
