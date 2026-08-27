# Server-ready základ P0

Aplikace: **lesson-hub**

P0 zavádí verzovaný kontrakt `ghrab-deployment-config-v1`. Výchozí soubor `config/deployment.json` zachovává současný provoz na GitHub Pages. Soubor `config/deployment.school-server.example.json` je šablona budoucího školního profilu a neobsahuje tajné údaje.

## Co je v P0 hotovo

- cesty k AI Studiu a přístupové bráně se při startu odvozují z konfigurace;
- chybějící konfigurace vede k bezpečnému GitHub fallbacku;
- reportér není součástí kritické cesty startu;
- konfigurace je načítána s `cache: no-store`;
- školní profil počítá se serverovou relací, interním API a zákazem klientských provider klíčů.

## Co P0 ještě neaktivuje

P0 nespouští školní backend ani nepřepíná AI volání na School Gateway. To patří do P1. Šablonu školního profilu nelze nasadit bez doplnění serveru, cookies, CSRF/CORS politiky, limitů a správy tajných klíčů.

## Přepnutí profilu

Při serverovém buildu se výchozí `config/deployment.json` nahradí schválenou produkční konfigurací odvozenou ze školní šablony. Zdrojový kód aplikace se kvůli změně hostingu neupravuje.
