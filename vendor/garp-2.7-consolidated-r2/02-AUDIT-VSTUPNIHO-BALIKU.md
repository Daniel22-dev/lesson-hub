# Audit vstupního pracovního balíku GARP 2.7

Datum: 17. 9. 2026.
**Verdikt: smysluplná architektura, ale zatím nezpůsobilá k finálnímu zmrazení
nebo použití zdejších validátorů jako samostatného důkazu produkční bezpečnosti.**


> **Konsolidační stav 2026-09-23-r1:** níže uvedené A-01 až A-07 zůstávají historickým
> auditem původního pracovního balíku. Náhradní `MASTER/` v tomto balíku obsahuje
> referenční opravy a 20/20 pozitivních/negativních contract selftestů. Původní
> chybné validátory nebyly přepsány; nejsou autoritou pro nové migrace.
> Serverová implementace je rozhodnutím vlastníka odložena a LIVE zůstává NOT_TESTED.

## Rozsah a metoda

Posuzován výhradně dodaný `GARP-2.7-MASTER-WORKING(2).zip`.
SHA-256: `e21ad2dcb165465ab818caee01719182ffc8400b689c2bc73c7973c34dc9f075`.

Archiv má 313 položek včetně adresářů, 274 souborů; 46 souborů MJS a 56 JSON.
Bezpečně rozbalen do pracovní kopie. Zkontrolovány hlavní architektonické kontrakty,
nové master moduly, relevantní historické baseline části, schémata,
předložené validátory a jejich selftesty. Vybrané lokální validátory byly
spuštěny nad syntetickými JSON vstupy. Původní archiv nebyl upraven.

Prostředí: Node.js v22.16.0, lokální kontejner.
Nebylo testováno Node 24/Alpine, školní nasazení, síť, Fortinet, GitHub repozitáře,
konkrétní aplikace ani živý model. Není to penetrační test nasazeného ekosystému.

Závažnost níže označuje prioritu pro dokončení bezpečnostního kontraktu.
Není to CVSS ani potvrzení exploatovatelnosti konkrétní produkční aplikace.
Validátor tvaru dokumentu nemusí sám být produkční gate. Nález znamená, že
jeho současné PASS k takovému účelu nestačí a rozdíl musí být výslovný.

## Co bylo skutečně spuštěno

`node TOOLS/selftest-garp27-master.mjs`:
**PASS, 19 kontrol, 19 úspěšných.**

`node TOOLS/verify-sha256s.mjs`:
**PASS, 273 zkontrolovaných položek.**
Samotný kořenový seznam SHA256SUMS.txt není sám sobě položkou.
Tento výsledek dokládá shodu s přiloženým seznamem, nikoli nezávislé ověření vydavatele.

Dále 13 cílených lokálních sond:
11 zkoumaných neúplných nebo bezpečnostně rozporných vstupů bylo přijato;
2 sondy ukázaly, že nové master validátory odmítají garpVersion=2.7.
Nejde o „13 prolomených aplikací“. Jde o 13 reprodukovaných pozorování
ve čtyřech relevantních validátorech.

| Sonda | Skutečný výsledek |
|---|---|
| `ASSURANCE_PASS_WITH_FAILED_COMPONENT` | Přijato (exit 0) |
| `ASSURANCE_PASS_WITHOUT_EVIDENCE` | Přijato (exit 0) |
| `ASSURANCE_MISSING_REQUIRED_ENVIRONMENT` | Přijato (exit 0) |
| `ASSURANCE_DUPLICATE_COMPONENT` | Přijato (exit 0) |
| `ASSURANCE_REJECTS_27` | Odmítnuto (exit 1) |
| `APG_COMMITTED_EMPTY_GATES` | Přijato (exit 0) |
| `APG_COMMITTED_MISSING_GATES` | Přijato (exit 0) |
| `APG_COMMITTED_ALL_GATES_NA` | Přijato (exit 0) |
| `APG_COMMITTED_SOURCE_NOT_ALLOWED_NO_EVIDENCE` | Přijato (exit 0) |
| `APG_MISSING_REQUIRED_POLICY` | Přijato (exit 0) |
| `APG_REJECTS_27` | Odmítnuto (exit 1) |
| `LIVE_PASS_WITHOUT_SERVER_EVIDENCE` | Přijato (exit 0) |
| `POLICY_EMPTY_CRITICAL_SECTIONS` | Přijato (exit 0) |

Výstupy včetně stderr, návratových kódů a přesných fixture jsou v EVIDENCE/.
K reprodukci je určen TOOLS/reproduce_input_audit.py.

## A-01 — ASSURANCE přijme celkový PASS s chybějící a selhanou komponentou

Priorita: **P0 před použitím pro admission/produkční zelený stav.**

Soubor `ASSURANCE/TOOLS/validate-assurance-status.mjs`, řádky 9–18.
Validátor ověřuje přítomnost některých identit a povolené hodnoty jednotlivých enumů.
Neodvozuje však overall ze stavu komponent a nezjišťuje důvěryhodné důkazy.

Reprodukce:
overall=PASS, ale komponenta má presence=MISSING, health=DOWN,
effectiveness=FAIL a evidenceFreshness=STALE. Výsledek validátoru: exit 0, PASS.

Druhá sonda nastavila efektivitu na PASS a čerstvost FRESH bez doloženého
testu, s prázdnými evidenceRefs a nevyplněnými časovými údaji. Také přijato.
Přijaty byly i duplicitní componentId.

Dopad: při zaměnění strukturální validace za potvrzení ochrany může dashboard
nebo gate přijmout nedoložený bezpečný stav.
Neprokázalo se, že tento validátor již takto používá některá aplikace.

Náprava: oddělit validaci tvaru od posouzení důkazů. Agregátor načte povinné
komponenty z důvěryhodného profilu, odvodí overall, ověří identitu releasu,
prostředí, čas, úplnost, jedinečnost a důvěryhodnost evidence.
PASS nemá být vstupní autoritativní přepínač.

Přejímací test: všechny uvedené nepřípustné kombinace odmítnout; současně
přijmout doložený kompletní pozitivní příklad a bezpečný DEGRADED jako DEGRADED,
nikoli nesprávně jako plně zdravou službu.

## A-02 — AUTO-PATCH přijme COMMITTED bez kontrolních bran

Priorita: **P0 před použitím jako release/deploy gate.**

Soubor `AUTO-PATCH-GUARD/TOOLS/validate-auto-patch-manifest.mjs`, řádky 14–15.

Syntetický manifest state=COMMITTED a gates={} je přijat.
Přijat je i manifest, v němž gates zcela chybí, a manifest se všemi gates=N/A.

Příčina: `Object.values(x.gates || {}).some(...)` nevyžaduje žádnou
povinnou položku. U prázdné množiny nenajde FAIL a u N/A také ne.

Dopad: absence kontroly se může vyhodnotit jako dokončená aktualizace.
Jde o skutečné chování předloženého validátoru, nikoli o prokázaný deploy bypass
na školním serveru.

Náprava: pevně definovat povinné gate IDs podle schváleného profilu;
vyžadovat úplnost, typy, přípustnost N/A a reálné důkazy.
Stav COMMITTED musí vzniknout řízeným dokončením skutečných přechodů.

Přejímací test: missing/empty/partial gates, zakázané N/A, neznámá gate,
FAIL, NOT_TESTED a podvržená evidence zabrání přijetí i přechodu.

## A-03 — AUTO-PATCH neověřuje pravdivost deklarovaných PASS

Priorita: **P0 před nasazením aktualizační hranice.**

Tentýž validátor, řádky 8–17.
Manifest se všemi gates=PASS je přijat, přestože source.allowlisted=false,
identifikátory a digest jsou placeholdery a evidenceRefs je prázdné.
Samostatná sonda bez celého povinného objektu policy je rovněž přijata.

Rozlišení: strukturální dokument může nést tvrzení „PASS“.
To ovšem nepotvrzuje platný podpis, důvěryhodný zdroj, správný digest ani skutečné
provedení gate. JSON pole nikdy nesmí nahradit ověření těchto vlastností.

Náprava: produkční gate musí ověřit artefakt a důkazy proti důvěryhodným
očekáváním mimo kontrolu kandidáta. Dodat stavový automat s tranzitními
podmínkami, ochranou proti replay a jednoznačnou identitou cíle.

## A-04 — Validátory a požadavky schémat/dokumentace nejsou konzistentní

Priorita: **P1, blokuje freeze.**

`ASSURANCE/SCHEMAS/security-assurance-status.schema.json`, řádky 5–13,
vyžaduje environment. `validate-assurance-status.mjs` jej nekontroluje;
manifest bez environment byl přijat.

`AUTO-PATCH-GUARD/SCHEMAS/auto-patch-manifest.schema.json`, řádky 5–13,
vyžaduje policy a gates. Zkoumaný validátor jejich absenci přijme.

`FOUNDATION/TOOLS/validate-garp-policy.mjs` přijme politiku s prázdnými
identity/incident/securityHealth/inventory. Neodmítne všechny relevantní
placeholdery, přestože FND-02 říká, že placeholdery nejsou PASS.

`SHIELD-LIVE/TOOLS/validate-live-profile.mjs` přijme overall=PASS a všech
20 controls=PASS bez serverových důkazů. To je nejvýše přijetí deklarace tvaru,
nikoli SHIELD-LIVE PASS.

Náprava: jedna autoritativní definice schématu pro každý aktuální kontrakt;
důsledné vynucení typů a povinných polí plus samostatná sémantická kontrola.
Režim TEMPLATE_VALID/SCHEMA_VALID jasně odlišit od DEPLOYMENT_ADMISSIBLE.
Testovat rovněž null, nesprávné typy, prázdné hodnoty, neznámé kontroly,
duplicitní klíče/ID, nesmyslné časové údaje a limity velikosti.

## A-05 — Nové master moduly jsou označené 2.7, ale vyžadují 2.6

Priorita: **P1, kompatibilita a význam kontraktu.**

`ASSURANCE/TOOLS/validate-assurance-status.mjs`, řádek 12;
`ASSURANCE/TOOLS/validate-capability-manifest.mjs`, řádek 7;
`AUTO-PATCH-GUARD/TOOLS/validate-auto-patch-manifest.mjs`, řádek 9.

Odpovídající nová schémata mají const=2.6. Validation pack manifesty uvádějí
garpCompatible pouze 2.6. Dvě vykonané sondy s garpVersion=2.7 skončily odmítnutím.

Historická 2.6 ve záměrně zachovaných FOUNDATION/SHIELD-LIVE kopiích
není sama o sobě chybou. Problém je nevyjasněná kompatibilita nových 2.7 modulů.

Náprava: explicitně rozhodnout 2.7 kontrakt nových součástí a starý 2.6 adapter.
Historické balíky nepřepisovat hromadným nahrazováním řetězců. Testy musejí
odlišovat archivní formát, aktuální formát a nepodporovanou verzi.

## A-06 — Podmíněná bezpečnost produkčního testu není strojově vyjádřená

Priorita: **P1 před automatickým produkčním runnerem.**

`VALIDATION-PACKS/RUNTIME/01-RUNTIME-VALIDATION-PACK.txt`, řádky 4–5:
RVP-01 je PROD_SAFE pouze pro schválený lokální/dedicated sink,
jinak STAGING_ONLY.

`VALIDATION-PACKS/RUNTIME/PACK-MANIFEST.json`, řádky 10–12:
RVP-01 je bezpodmínečně označen PROD_SAFE.
Manifest nevyjadřuje potřebné ověření cíle a schválení.

Je to staticky doložený rozpor. Nebyl spouštěn produkční runner ani síťová sonda.

Náprava: bezpečná třída vázaná na ověřené preconditions, allowlist cílů a
limity. Bez splnění podmínek se test nespouští a zapíše NOT_TESTED.
Rozlišit read-only inventarizaci od aktivního požadavku do sítě.

## A-07 — Selftest prokazuje užší vlastnosti, než může naznačovat jeho PASS

Priorita: **P1 pro způsob reportování; nejde o zákaz selftestu.**

`TOOLS/selftest-garp27-master.mjs`, řádky 4–14.
Ověřuje přítomnost dokumentů, vnořené dílčí selftesty, checksumy,
shodu vložených baseline a některé manifestové příznaky.

To je užitečné ověření integrity pracovního balíku a základní konzistence.
Není to 19 úspěšných bezpečnostních scénářů na aplikacích.
Nové ASSURANCE/APG selftesty mají jen úzké negativní případy:
nepovolený enum a COMMITTED s NOT_TESTED.
Neodhalily výše reprodukované případy prázdných gates a rozporného PASS.

Náprava: výsledky pojmenovat PACKAGE_SELFTEST, SCHEMA_TEST, CONTRACT_TEST,
APP_BEHAVIOR_TEST a LIVE_TEST. Přidat cílené negativní i pozitivní kontroly,
nezávislý původ evidence a testy integrity samotného harnessu.

## Co zachovat

Zásadní přínosy vstupu: oddělení FOUNDATION/LIVE, 12 AG oblastí,
čtyřosý assurance, omezení rozsahu zásahu, samostatné packy, oddělená
aktualizační identita, explicitní zákaz falešného LIVE PASS,
kontrakty infrastruktury a rozsáhlá RT-00..20 / AIR baseline.

Nedává smysl tuto práci zahodit a založit novou konkurenční bezpečnostní vrstvu.
Priorita je převést deklarované hranice do skutečného vynucení a prokazování.

## Co z tohoto auditu neplyne

- Neříká, že aplikace mají uvedené produkční zranitelnosti.
- Neříká, že GARP 2.5/N5 v konkrétních repozitářích chybí nebo nefunguje.
- Nepotvrzuje funkční egress, odvolání relace, karanténu, obnovu ani monitoring školy.
- Nepotvrzuje ochranu proti host-root kompromitaci.
- Neoznačuje 13 lokálních sond za komplexní bezpečnostní audit celého ekosystému.
- Nepředstírá opravení zkoumaných validátorů. Tento výstup obsahuje audit,
  cílový protokol, testovací katalog a reprodukční nástroj.

## Doporučené rozhodnutí

Ponechat GARP 2.7 jako cílový kontrakt. Nejprve uzavřít A-01 až A-07 a
zpřesnit rozdíl „validní dokument“ / „důvěryhodný důkaz“ / „účinná ochrana“.
Poté implementovat a prokázat ochrany na reálných aplikacích a stagingu.
Finální freeze nepřiznat na základě samotného průchodu původním selftestem.
