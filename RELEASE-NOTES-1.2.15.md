# Lesson Hub 1.2.15 — GARP 2.3 legacy/restore hardening

Verze 1.2.15 navazuje na kandidáta 1.2.14 po druhém nezávislém kole Claude.

Bezpečnostní změny:
- legacy `visibility=shared` už samo o sobě neposkytuje cross-user čtení; server vždy posuzuje i typ resource,
- při startu i po obnově zálohy se normalizují starší citlivé visibility a auditní metadata,
- sync historie s legacy broad visibility se při otevření store normalizuje,
- citlivé a unscoped substitution přílohy se při otevření store normalizují na `private`,
- neúspěšné přihlášení neukládá raw e-mail ani reverzibilně dohledatelný `emailHash`.

Pedagogické workflow a datové formáty aplikace se nemění. Oprávněné `shared` materiály a materiály pro zastupování zůstávají dostupné podle stávajícího modelu oprávnění.
