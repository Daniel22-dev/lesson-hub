# Lesson Hub 1.2.4 — etapa P2

Etapa P2 sjednocuje aplikaci s ekosystémem AI Studio GHRAB bez změny její odborné funkcionality.

## Doručeno

- GHRAB Platform 1.0.0 (`ghrab-platform-v1`) s kontrolou kompatibility.
- Kanonický logotyp školy (SHA-256 `300396a48cc36d8c2abda0aea673273d4d985476ba88fb0430630ef89ac86770`).
- Jednotná patička `ghrab-footer-v1`; funkční prvky původních patek zůstávají zachovány.
- Motivový kontrakt `ghrab-theme-v1` s kompatibilitou pro dosavadní přepínače.
- Vratná migrace aplikačních dat do prefixu `ghrab.lesson-hub.*`; záloha se vytváří před odstraněním starých klíčů.
- Studio Bridge 2.0 s dočasným čtením starého `ghrab-handoff-v1`.
- Artifact envelope v1 jako společné rozhraní pro nové exporty; dosavadní formáty zůstávají čitelné.
- PWA cache `ghrab-lesson-hub-v1.2.4` a aktualizační zpráva `GHRAB_SKIP_WAITING`.
- Konformitní test `npm run qa:platform` a school-server build označený P2.

## Kompatibilita

P2 zachovává přímý GitHub Pages profil i školní serverový profil z P1. Migrace úložiště má rollback API `GHRAB_PLATFORM.rollbackStorageMigration()`.
