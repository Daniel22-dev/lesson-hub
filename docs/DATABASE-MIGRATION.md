# Lesson Hub — cesta z JSON úložiště na databázi (P3)

## Aktuální stav

Produkční P3 profil používá `LESSON_HUB_STORAGE_DRIVER=json`. Zápisy jsou serializované, atomické (`.tmp` → `fsync` → `rename`) a při obnově je store fail-closed. Aplikace nyní závisí na rozhraní `lesson-hub-store-adapter-v1`, nikoli přímo na konstruktoru JSON store.

## Spouštěče migrace

Databázovou migraci zahájit, jakmile nastane alespoň jedna podmínka:

- datový JSON pravidelně přesáhne 15 MB;
- více než 10 000 aktivních záznamů a časté souběžné zápisy;
- p95 zápisu přesáhne 750 ms nebo p95 načtení přesáhne 2 s na školním serveru;
- je požadován víceprocesový/horizontálně škálovaný provoz;
- škola potřebuje transakce napříč více záznamy, pokročilé reporty nebo přesné databázové retenční politiky.

## Cílový adaptér

První podporovaná databáze má být PostgreSQL. Adaptér musí plnit `lesson-hub-store-adapter-v1`: `open`, `save`, `resource`, `nextCursor`, `pruneSessions`, `freeze`, `unfreeze` a vlastnost `data`. Před ostrou migrací je vhodné dále oddělit doménové repository metody, aby databázový adaptér nemusel emulovat celý objekt v paměti.

## Migrační postup

1. Uzamknout zápisy (`freeze`) a vytvořit ověřený snapshot.
2. Validovat JSON schéma a přílohy.
3. Importovat uživatele, zdroje, relace, změny, audit a privacy policy v jedné řízené migraci.
4. Porovnat počty, SHA-256 exportu a referenční vazby.
5. Spustit čtecí shadow provoz a kapacitní testy.
6. Přepnout `LESSON_HUB_STORAGE_DRIVER=postgres` až po úspěšném rollback testu.
7. Původní snapshot ponechat šifrovaně podle retenční politiky a poté bezpečně odstranit.

P3 databázový ovladač nedodává, protože nejsou známé parametry školního serveru ani spravované databáze. Dodává však kontrakt, měřený baseline a jasný okamžik, kdy migraci provést.
