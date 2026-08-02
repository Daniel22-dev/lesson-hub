# Oprava GitHub QA — Lesson Hub 1.1.3

## Příčina

Skutečná Playwright brána v GitHub Actions předávala cestu například `/index.html#/overview` pomocné funkci pro načtení lokálního dokumentu. Funkce odstranila query string, ale ne fragment za `#`, a pokusila se proto otevřít neexistující soubor `dist/index.html#/overview`. Nález byl vytvořen správně jako `VISUAL_RUNTIME`, ale konzolový reportér četl neexistující vlastnost `summary` místo `message`, takže výpis obsahoval pouze `undefined`.

## Oprava

- souborová cesta se oddělí od hashové trasy;
- hash se vloží do dokumentu před spuštěním aplikačních modulů;
- QA dokument má izolované dočasné `localStorage` a `sessionStorage`;
- kontroluje se únik cesty mimo kořen buildu;
- reportér vypisuje `message` a případné `evidence`;
- regresní test ověřuje hashovou cestu i zákaz výpisu bez popisu.

## Dopad

Změna se týká pouze testovací a release infrastruktury. Datový model, lokální IndexedDB ani serverové API se nemění.
