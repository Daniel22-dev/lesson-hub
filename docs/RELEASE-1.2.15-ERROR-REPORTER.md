# Lesson Hub 1.2.15 — sjednocený reportér

Verze 1.2.15 zachovává sjednocený error reporter z verze 1.2.11 beze změny jeho uživatelského workflow. Nadále používá dvoukrokové vytvoření a skutečné stažení diagnostického ZIPu před zpřístupněním Gmailu, výslovný pokyn k ručnímu přiložení ZIPu, bezpečně skryté pomocné video a fyzické ověření staženého souboru v browserové regresi.

Bezpečnostní kandidát 1.2.15 zachovává workflow reportéru a doplňuje serverové privacy hardening opravy, regresní kontroly a synchronizaci release metadat. Samotný reportér nemění své uživatelské workflow.

Tento soubor je zároveň verzovaným dokladem očekávaným regresní sadou reportéru v `reporter-test.config.json`.


Bezpečnostní kolo GARP 2.3 pro 1.2.15 navíc uzavírá legacy `shared` autorizaci při čtení, normalizaci po obnově serverové zálohy a odstraňuje slovníkově dohledatelný `emailHash` z auditních metadat. Zachovává přitom opravy substitution, attachmentLinks, privacy policy příloh, `no-store` API požadavků a CI dependency auditu z 1.2.14.
