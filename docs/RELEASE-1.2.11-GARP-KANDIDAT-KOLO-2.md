# Lesson Hub 1.2.11 — GARP kandidát pro 2. kontrolu Claude

Datum: 27. 8. 2026

Tento patch vznikl v GARP fázi C po nezávislé kontrole kandidátu 1.2.10 Claudem. Nemění pedagogické workflow ani běžný datový formát. Opravuje potvrzené bezpečnostní nálezy z prvního kontrolního kola a jeden související autorizační problém nalezený při povinné kontrole okolního kódu.

## Opravy po Claude kole 1

1. **Nebezpečné samostatné identifikátory jsou blokované.** `__proto__`, `prototype` a `constructor` již neprojdou validací `entityId` ani jiných strukturálních identifikátorů.
2. **Resource mapy serveru jsou bez prototypu.** `JsonStore.resource()` vrací mapy založené na `Object.create(null)`, takže i případný budoucí validační omyl nemůže přepsat prototyp mapy přes klíč `__proto__`.
3. **URL hardening nevisí pouze na názvu `url`.** Běžné aliasy (`link`, `href`, `src`, `homepage`, `website`, `odkaz`, `zdroj`) jsou kontrolovány jako URL a jasně spustitelné `javascript:`, `vbscript:` a skutečné `data:` URL jsou blokovány bez ohledu na název pole. Běžný pedagogický text typu `Data: interpretace výsledků` zůstává povolen.
4. **Veřejná CSP už nepovoluje localhost návštěvníka.** GitHub Pages profil používá `connect-src 'self'`. Localhost výjimka není součástí veřejného HTML ani statického bezpečnostního kontraktu.
5. **Cross-user odesílání přes `process-due` je uzavřeno.** Učitel může ručně spustit pouze zpracování vlastních zpráv. Globální zpracování zůstává dostupné vlastníkovi/správci a internímu serverovému scheduleru.

## Vyhodnocení frame-ancestors

Doporučení vložit `frame-ancestors 'none'` do statického `<meta http-equiv="Content-Security-Policy">` nebylo převzato jako účinná oprava, protože `frame-ancestors` není v meta CSP spolehlivě vynutitelná bezpečnostní hranice. School-server profil již používá skutečnou HTTP CSP hlavičku s `frame-ancestors 'self'` a `X-Frame-Options: SAMEORIGIN`. Veřejný GitHub Pages profil tuto hlavičku bez serverové vrstvy nemůže pravdivě deklarovat jako vynucenou.

## Regrese

Doplněny jsou testy pro samostatný `entityId="__proto__"`, zachování existující resource mapy po odmítnutém útoku, URL aliasy, neškodný pedagogický text s dvojtečkou, zákaz localhostu ve veřejné CSP a zákaz učiteli spustit cizí zprávu přes `process-due`.
