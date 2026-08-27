# Lesson Hub 1.2.10 — GARP bezpečnostní kandidát

Datum: 26. 8. 2026

Tento patch release vznikl jako první implementační fáze GARP auditu. Nemění pedagogické workflow ani datový formát běžných záznamů. Zpřísňuje pouze bezpečnostní hranice kolem lokálního QA přístupu, nedůvěryhodných importů/synchronizace a CI supply chain.

## Bezpečnostní změny

1. **QA přístup fail-closed mimo lokální origin.** Parametr `?qa=1` a `navigator.webdriver` již nestačí k udělení administrátorského lokálního permitu na veřejném originu.
2. **Validace importů a synchronizace.** Strukturální pole nedůvěryhodných záznamů se validují před zápisem; blokují se prototype-pollution klíče, nebezpečné identifikátory/tokeny, nepovolené URL protokoly a patologické struktury. Volný pedagogický text se tímto filtrem nemění.
3. **Serverová validace.** Stejná třída kontrol probíhá před uložením REST/sync payloadu, takže škodlivý sdílený záznam nemá být distribuován dalším klientům.
4. **GitHub Actions.** Externí Actions jsou připnuté na ověřené commit SHA; auditní test vyžaduje 40znakový SHA.

## CSP

Statický profil vynucuje CSP přímo v HTML, protože GitHub Pages neposkytuje projektu vlastní HTTP bezpečnostní hlavičky. Spouštění skriptů spadá pod `default-src 'self'`; `unsafe-inline` ani `unsafe-eval` nejsou povoleny. `style-src 'unsafe-inline'` zůstává jako úzká kompatibilitní výjimka kvůli inline access-gate stylům; školní serverový profil používá stejnou zásadu pro skripty v HTTP hlavičce.

## Kompatibilita

Databázové schéma, běžné exporty, role, serverové API kontrakty a pedagogické funkce zůstávají kompatibilní. Záměrně odmítnuty jsou pouze strukturálně nebezpečné nebo patologické importované/serverové záznamy.
