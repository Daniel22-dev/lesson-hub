# Lesson Hub – etapa 04 / centrální skupiny

Tento dokument eviduje rozpracované propojení Lesson Hubu s AI Studio „Moje skupiny“.

Stav: **WORK IN PROGRESS**. Samotné vytvoření větve nebo tento dokument neznamenají integraci, certifikaci ani nasazení.

## Release gates

1. Převzít přesný integrační kandidát V5 do zdrojového checkoutu založeného na `c2cfcc457acf81898522cb63cfb09446504d01ea` bez obcházení SHA guardu.
2. Zajistit metadata-only consumer `lesson-hub`; studentská jména ani e-maily se z AI Studia nenačítají.
3. Ověřit unikátní `canonicalGroupId`, přechod školního roku, zachování pedagogické historie, atomické operace a bezpečný import zálohy.
4. Spustit kompletní QA, P5/GARP/Platform, browser a multi-tab scénáře. Limit distribuce zůstává 1 225 000 B.
5. Teprve po všech PASS připravit vydání a aktualizovat registr AI Studia.

**NO DEPLOY** do splnění všech bran a potvrzení aktuálního release artefaktu.
