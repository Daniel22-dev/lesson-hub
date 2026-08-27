# Reakce na navazující audit Lesson Hubu 1.1.1

## Výsledek

Navazující audit potvrdil, že opravy z verze 1.1.1 byly provedeny poctivě, a popsal sedm zbývajících nebo nově vzniklých problémů. Všechny nálezy N1–N7 byly přijaty a opraveny ve verzi 1.1.2.

## N1 — bezpečnostní brána a HTML vracené render funkcemi

**Stav: opraveno.**

Bezpečnostní detektor nyní nekontroluje pouze přímé přiřazení do `innerHTML`, ale také HTML šablony vracené funkcemi typu `render*`, `*Markup` a `*Banner` v `src/ui/` a `src/pages/`. Zachována je pouze výslovná řádková výjimka `qa-safe-html` pro doložené bezpečné případy.

Regresní test ověřuje:

- přímou nebezpečnou interpolaci,
- nebezpečný návrat z `renderX()`,
- bezpečnou variantu s `escapeHtml`,
- skutečný soubor `src/ui/layout.js`,
- umělé odstranění escapování z layoutu, které musí brána zachytit.

## N2 — nákladný ořez klientského auditu

**Stav: opraveno.**

Ořez auditu se již nespouští při každém zápisu. Kontrola proběhne amortizovaně po každých 100 zápisech a úplné načtení nastane pouze tehdy, když počet záznamů překročí 5 500. Následně se audit ořízne na posledních 5 000 záznamů s respektováním časové retence.

Regresní test potvrzuje, že 100 auditních zápisů při 5 000 uložených záznamech nevyvolá úplné `getAll()` ani opakované řazení.

## N3 — obnovená lokální záloha a serverová synchronizace

**Stav: opraveno.**

Po úplné obnově v režimu `replace` aplikace:

1. vyčistí starou synchronizační frontu a konflikty,
2. vynuluje značku posledního připraveného auditu,
3. vytvoří deterministické `upsert` položky pro všechny synchronizovatelné obnovené entity,
4. uloží stav `sync:restorePending`,
5. zobrazí trvalé upozornění, že obnovený stav ještě nebyl odeslán na server.

U přihlášeného uživatele je dostupné přímé tlačítko pro odeslání obnoveného stavu. Upozornění zmizí až tehdy, když ve frontě nezůstane žádná obnovovací položka ve stavu `pending`, `failed` nebo `blocked`.

## N4 — rozsah retenčního úklidu

**Stav: opraveno.**

Výchozí rozsah retenčního úklidu je nově `self`, tedy pouze vlastní data. Role `owner` a `admin` mohou výslovně zvolit `all`. Běžný učitel nemůže globální úklid spustit.

Náhled před potvrzením zobrazuje tabulku rozdělenou podle vlastníků včetně jejich jména a počtů dotčených studentů, zpráv a příloh. Potvrzení je dostupné až po získání tohoto náhledu.

## N5 — poslední dynamická hodnota v layoutu

**Stav: opraveno.**

Výstup `accessInitials()` prochází přes `escapeHtml`. Současně byly zkontrolovány a escapovány i související dynamické hodnoty společného layoutu.

## N6 — verze interaktivního manuálu

**Stav: opraveno.**

Zdroj manuálu používá zástupnou značku `__APP_VERSION__`. Build ji nahrazuje aktuální verzí aplikace a kontrola verzí ověřuje, že manuál zůstává řízeným verzovaným souborem. Produkční manuál proto zobrazuje 1.1.2.

## N7 — osiřelé adresáře serverových záloh

**Stav: opraveno.**

Retenční úklid nově prochází také:

- dočasné adresáře `.tmp-backup_*`,
- adresáře `backup_*` bez platného manifestu.

Neplatné adresáře starší než 24 hodin odstraní. Regresní serverový test vytváří oba typy osiřelých adresářů a ověřuje jejich úklid.

## Ověření

Pro verzi 1.1.2 prošly:

- `npm test`,
- technická brána,
- bezpečnostní brána s nulou nálezů,
- PWA brána,
- kombinatorická brána se 100% pairwise pokrytím,
- 25 kritických workflow,
- 61 vizuálních scénářů,
- headless smoke test.

Čisté `npm ci` a síťový `npm audit` nebylo možné v pracovním kontejneru dokončit kvůli nedostupnému registru. Lokální verdikt je proto správně `AUTOMATED_INCOMPLETE`. GitHub Actions tyto kontroly nesmí přeskočit a jejich selhání zablokuje nasazení.
