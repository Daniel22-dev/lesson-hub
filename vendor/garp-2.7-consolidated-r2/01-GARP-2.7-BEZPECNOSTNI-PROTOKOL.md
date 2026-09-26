# GARP 2.7 — bezpečnostní protokol AI Studia

**Stav: NÁVRH K IMPLEMENTACI A NEZÁVISLÉMU REVIEW. Není to nasazený štít ani certifikace.**
Datum: 17. 9. 2026. Verze architektonického kontraktu: 2.7.
Konsolidace: doplněná brána architecture-integrity a přesné hranice implementace.
Východisko: GARP-2.7-MASTER-WORKING(2).zip, SHA-256
e21ad2dcb165465ab818caee01719182ffc8400b689c2bc73c7973c34dc9f075.

Tento dokument je konsolidovaný cílový protokol, nikoli tvrzení o stavu aplikací.
Konkrétní chyby vstupních validátorů, provedené testy a jejich omezení jsou v auditu.
Původní archiv se nemění. Přijetí tohoto návrhu musí předcházet jeho použití jako normativního zdroje.
Do té doby při rozporu nelze zvolit slabší pravidlo a udělit PASS; rozpor blokuje zmrazení kontraktu.

## 1. Cíl a poctivá hranice ochrany

GARP má omezit pravděpodobnost průniku, rozsah škody po průniku, dobu do zjištění
incidentu a obtížnost bezpečné obnovy. Nejde o počet scannerů, regexů ani zelených ikon.

Firewall, serverové zabezpečení a GARP fungují současně. GARP nečeká na ohlášení
selhání firewallu. Aplikační autorizace se provádí při každé relevantní operaci,
i když požadavek přišel z vnitřní sítě nebo z jiné aplikace Studia. [S02]

Počítáme s těmito situacemi:
- nepřihlášený útočník i držitel odcizené, jinak platné učitelské relace;
- škodlivý nebo chybně strukturovaný dokument, import či výstup modelu;
- selhání modelové ochrany proti prompt injection;
- kompromitace jedné aplikace v rozsahu oprávnění jejího procesu;
- podvržená aktualizace, kompromitovaný repozitář nebo omezený aktualizační token;
- selhání služby, přetížení, časový posun, souběh operací, výpadek logování;
- úmyslné falšování evidence a zneužití bezpečnostního dashboardu.

Úplné převzetí hostitele/root účtu je vyšší hranice. Ochrana běžící na stejném
hostiteli není vůči jeho správci nezávislou autoritou. Kontejnery a oprávnění
omezují riziko, ale nejsou zárukou proti převzetí hostitele. [S03]
Proto auditní úložiště, alespoň základní watchdog a obnovitelné zálohy musí mít
oddělená oprávnění; pro přežití ztráty hostitele také jiný stroj či jinou
důvěryhodnou službu. Bez této nezávislosti se nepřiznává odolnost proti kompromitaci hostitele.

Zbytková rizika se uvádějí výslovně: nezjištěná zranitelnost, kompromitovaný
privilegovaný správce, únik dat dostupných již kompromitovanému procesu,
chybná odpověď modelu, výpadek celé sítě. Přístupy se minimalizují i proto,
že nelze zaručit zachování tajemství dat, která proces legitimně potřebuje číst.

## 2. Jedna architektura, nikoli další vrstva značek

Zachovávají se stávající oblasti AG-01 až AG-12. FND, LIVE, MAS a APG jsou
kontrolní pohledy na tyto oblasti, nikoli čtyři další plnohodnotné ochranné enginy.

FOUNDATION je ověřování kontraktu, kódu a artefaktů před nasazením.
SHIELD-LIVE je skutečné vynucování a jeho provozní ověření.
ASSURANCE je sběr a vyhodnocení důkazů, nikoli oprávnění sama sobě vydat PASS.
AUTO-PATCH-GUARD chrání aktualizační cestu; auto-patch sám není bezpečnostní audit.
VALIDATION-PACKS obsahují nezávisle verzované testy.
Platforma a AI Core jsou implementační součásti ekosystému, nikoli konkurující normy.

| Oblast | Jediná hlavní odpovědnost | Kde má být vynucena |
|---|---|---|
| AG-01 Policy Engine | Platná politika, její pravomoc, precedence a rozhodování | Serverový policy modul; správa mimo oprávnění dětské aplikace |
| AG-02 Identity Guard | Ověření identity, rolí, relací a oprávnění k objektům | Autentizační vrstva + každá serverová operace pracující s chráněným objektem |
| AG-03 Request/API/AI Guard | Schéma vstupů, limity, bezpečné vykonání AI akcí | Aplikační vstupy, AI Core a serverové vykonávače akcí |
| AG-04 Egress Policy | Povolené odchozí cíle a omezení laterálního pohybu | Gateway/síťová hranice mimo proces aplikace |
| AG-05 File Guard | Karanténa, typ/velikost, bezpečné zpracování dokumentů | Oddělený omezený zpracovatel souborů |
| AG-06 Data Lifecycle | Izolace dat, minimalizace, cache, exporty, mazání | Aplikace, databáze/úložiště a úlohy pro mazání |
| AG-07 Release Integrity | Původ, identita a přijetí přesného artefaktu | Důvěryhodný build a oddělený nasazovací proces |
| AG-08 Configuration Drift | Rozdíl schválené a skutečné konfigurace | Serverová kontrola, nikoli pouze kontrola repozitáře |
| AG-09 Inventory | Skutečné endpointy, služby, aktiva a závislosti | Inventář porovnávaný se skutečnou aplikací a nasazením |
| AG-10 Security Health | Zdraví ochran a čerstvost jejich důkazů | Lokální kontroly + nezávislý dohled |
| AG-11 Containment/Recovery | Omezení zasažené části a ověřená obnova | Lokální blokace + řízená serverová obnova |
| AG-12 Orchestration/Alerting | Korelace, doručení událostí a řízené testy | Omezená služba; dashboard pouze schválené operace |

Společnou implementaci sdílet jako verzovaný modul, ne ručně kopírovat
rozdílné varianty stejné ochrany do každé aplikace. Aplikační adaptér smí
definovat vlastní objekty a datové toky, nesmí změkčit společná pravidla.
Síťová a privilegovaná omezení musí mít i vynucení mimo proces aplikace:
samotná knihovna se po převzetí tohoto procesu může obejít.

Jedna aplikace nemá přístup k datům, tajným údajům ani správě ostatních aplikací.
AI Core, aktualizátor, bezpečnostní kolektor a parser dokumentů nesdílejí univerzální
administrátorský token. Docker socket nepatří do kontejneru Studia ani dětské aplikace. [S03]

### 2.1 Tři různé mapy: odpovědnosti, kód a nasazení

AG-01 až AG-12 jsou odpovědnosti, nikoli povel vytvořit dvanáct služeb.
FOUNDATION, SHIELD-LIVE, ASSURANCE a AUTO-PATCH-GUARD jsou pohledy na životní
cyklus a důkazy. Ani ony nepředepisují počet kontejnerů. IMPLEMENTAČNÍ MODUL
a NASAZOVANÁ SLUŽBA nejsou totéž. Jedna přehledná knihovna může obsahovat
více logických modulů; privilegovaný aktualizátor naopak nesmí získat stejnou
identitu jako aplikace jen proto, že jsou ve společném repozitáři.

Cílem není „maximum kódu“, ale nejmenší srozumitelný systém, který prokazatelně
vynucuje potřebné hranice. OWASP výslovně spojuje jednoduchost mechanismů
a přezkoumatelnost s bezpečností; rozdělení má zůstat provozovatelné. [S13]

| Logické místo | Co sem patří | Co sem nepatří |
|---|---|---|
| contracts | Typy, schémata, význam stavů, verze veřejných rozhraní | Síť, databázový přístup, práva k nasazení |
| runtime | Sdílené serverové kontroly a rozhodování, limity, tvorba bezpečnostních událostí | Import aplikačních implementací, test runner, Docker administrace |
| adapters / u konkrétní aplikace | Vazba jejích operací, objektů a služeb na veřejné rozhraní GARP; relevantní integrační testy | Vlastní kopie obecného policy enginu, vypínač společné kontroly |
| services | AI Core, zpracovatel souborů, sběr událostí a další již potřebné samostatné služby | Univerzální administrátorská identita sdílená všemi službami |
| delivery | Ověření kandidáta, admission, aktualizátor a deklarace nasazení | Vykonávání pokynů z uživatelského dokumentu nebo z logu |
| verification | Společné testovací balíky, bezpečný runner, kontrola architektury | Import z produkční aplikace; distribuce útočných kampaní do jejího image |
| policies / inventory | Schválená pravidla, oprávnění, datové toky a mapování kontrol | Libovolný spustitelný kód, samooschválení zvýšených práv aplikací |

Názvy v tabulce jsou logická místa, ne povinný nový strom složek. Nejprve je
namapovat na existující repozitáře, Platform a AI Core; nerozbíjet fungující
strukturu kvůli přejmenování. Není požadován monorepozitář ani sedm nových služeb.

Schválený graf závislostí musí minimálně zachovat:
- contracts nezávisí na aplikacích, runtime ani privilegovaných službách;
- společný runtime nezávisí na konkrétní aplikaci;
- aplikace/adaptér používá veřejné rozhraní runtime a contracts, ne jejich
  neveřejné vnitřnosti, jinou aplikaci nebo nasazovací implementaci;
- verification může testovat veřejné rozhraní runtime, opačná závislost neplatí;
- delivery nesmí být importováno do běžné aplikace; komunikace s ním používá
  úzké autentizované rozhraní s omezenou pravomocí;
- síťová komunikace mezi aplikacemi je explicitní datový tok, nikoli způsob,
  jak zamaskovat zakázané sdílení oprávnění.

Sdílený zdrojový kód neznamená společný proces, klíč, databázový účet ani živé
přebírání neověřené verze. Každá aplikace připíná schválenou verzi knihovny.
Současné provozování dvou schválených kompatibilních verzí při řízeném rollout
není automaticky chyba. Uvnitř jednoho vynucovacího bodu však nesmějí nejasně
rozhodovat dvě konkurenční implementace téže politiky.

### 2.2 Co musí zůstat uvnitř aplikace

Bezpečnost nelze nahradit pouze vnějším proxy „obalem“. GARP dodá společné
mechanismy, ale aplikace musí při citlivé operaci předat serverem zjištěnou
identitu, akci a skutečný objekt či rozsah dat. Vlastnictví nebo oprávnění se
nepřebírá jako důvěryhodné tvrzení z požadavku klienta. Každá relevantní cesta
včetně jobu, exportu a interního API musí kontrolou skutečně projít. [S02]

Adaptér například určí, co je „práce ke zhodnocení“, kdo ji smí číst a jaký
je rozsah exportu. Obecné ověření tokenu se znovu nepíše v každé aplikaci.
Specifická pravidla objektu naopak nelze nahradit univerzálním „je přihlášen“.

Běžné unit a integrační testy mohou zůstat u zdrojového kódu aplikace.
Do produkčního artefaktu však nepatří test runner, privilegované testovací
účty, mock ověřování identity, ladicí bypass ani RED TEAM kampaně.
Čtecí health endpoint a omezené syntetické ověření nejsou automaticky zakázány;
musí mít vlastní oprávnění, schválený scope a nesmějí tvořit obecné testovací API.

### 2.3 Doplněná brána: architecture-integrity

Toto je jediná nově pojmenovaná kontrolní brána. Patří do FOUNDATION,
zejména pod AG-07, AG-08 a AG-09; nezakládá AG-13 ani další runtime engine.
Účel: zabránit, aby vývoj postupně obešel dohodnuté hranice a vytvořil několik
odlišných ochran bez jasné autority.

Vynucuje se v důvěryhodném CI a při přijetí konkrétního sestavení.
Vyžaduje schválenou mapu modulů, schopností a veřejných rozhraní, dále skutečný
kandidát, lockfile, build konfiguraci a nasazovací deklaraci. Politiku brány
nelze bez zvláštního review změkčit stejnou změnou, kterou má posoudit.

Pět povinných kontrol:
1. GRAF ZÁVISLOSTÍ: zakázané přímé i tranzitivní vazby, cykly přes dohodnuté
   bezpečnostní hranice a nevyřešené importy v bezpečnostně relevantním scope.
   Alias, re-export, generovaný soubor a podporovaný dynamický import se
   vyhodnotí podle skutečného build resolveru, nikoli jen hledáním textu.
   Co nástroj neumí vyhodnotit, není automaticky PASS; vyžaduje výslovné
   posouzení a odpovídající důkaz nebo se příslušné vydání zablokuje.
2. OBSAH ARTEFAKTU: inspekce skutečného serverového image, klientského balíku,
   zdrojových map a spouštěcích cest. Testovací infrastruktura, bypassy a
   tajné údaje nesmějí proniknout do distribuované aplikace.
   Samotné označení závislosti jako devDependency není dostatečný důkaz.
3. ROZDÍL SCHOPNOSTÍ: nové routy, joby, importy souborů, odchozí integrace,
   databázová práva, mounty a privilegované operace se porovnají se schváleným
   inventářem. Nová schopnost vyžaduje odpovídající autorizaci a testy,
   nikoli automatické převzetí předchozího N/A.
4. DŮVĚRYHODNOST BRÁNY: její vynechání, zúžení scope, chyba parseru, nulový počet
   skutečně kontrolovaných vstupů nebo vypnutí nástroje nemohou dát platný PASS.
   Výsledek je vázán na digest kandidáta, politiky, inventáře a nástroje.
   Required status na GitHubu sám nestačí bez kontroly původu, možného bypassu
   a skutečně vyhodnoceného obsahu; možnosti závisí na nastavení repozitáře. [S15]
5. JEDINÁ AUTORITA IMPLEMENTACE: každý rozhodovací bod má dohledatelný společný
   modul nebo zdůvodněné aplikační pravidlo. Přímé importy starého enginu,
   neschválená ruční kopie a změna veřejného kontraktu blokují přijetí.
   Duplicitní obecná pomocná knihovna v dependency stromu není sama o sobě
   bezpečnostní nález. Sémantickou shodu libovolného kódu nelze spolehlivě
   dokázat pouhým detektorem duplicity; součástí zůstává review změn.

Použít stávající build/lint nástroje a nejvýše doplnit chybějící typ kontroly.
Například dependency-cruiser podporuje pravidla zakázaných závislostí,
tranzitivního dosažení, nevyřešených importů a cyklů. To je příklad mechanismu,
ne požadavek přidat konkrétní závislost do všech aplikací. [S14]
Statická analýza sama neprokazuje nepřítomnost runtime obejití. Síťové,
identitní a datové hranice se nadále testují na stagingu.

Výstup brány: ověřovaný scope, vstupní digests, verze pravidel/nástroje,
zjištěné vazby, zakázané změny, nevyhodnocené části a výsledné rozhodnutí.
Nezavádí se skóre, které by kompenzovalo porušení hranice počtem čistých souborů.
Formát grafu či reportu nenahrazuje důkaz o skutečně provedené kontrole.

Hranice mohou být doloženě schváleny, ale výjimka nesmí zrušit kritický zákaz
uvedený v tomto protokolu. Přijetí legacy kódu není hromadná trvalá výjimka.
Každý přechodový adaptér má vlastníka, migrační podmínku a test kompatibility.

Přejímací případy G27-AR01 až G27-AR05 jsou v katalogu. Jsou to SPECIFIKACE;
v tomto balíku není dodaná ani nad repozitáři spuštěná implementace této brány.

### 2.4 Bezpečnost automatické obrany: omezený rozsah zásahu

Nejde o novou vrstvu, ale o zpřesnění AG-10 až AG-12. Bezpečnostní automatizace
nesmí dát falešnému signálu vyšší pravomoc než aplikaci, kterou chrání.

Detektor navrhuje událost; akční vykonávač ji posoudí podle samostatně chráněné
politiky. Dashboard ani obsah logu neurčují příkaz, libovolný cíl nebo práva.
Automatická reakce má typ akce, důvod, povolené cíle, maximální rozsah,
počet opakování, časový limit a ověřený postup návratu. Samotný autentizovaný
původ signálu není zárukou, že je navržený rozsah zásahu správný.

Odmítnutí zakázaného požadavku nevyžaduje souhlas člověka. Naproti tomu
rozšíření z izolace jedné aplikace na celý ekosystém nesmí vzniknout z jedné
slabé heuristiky. Plošný zásah vyžaduje schválený deterministický scénář
(např. ztrátu centrální důvěry), nebo oprávněného člověka.
Automatické obnovení po bezpečnostní izolaci neproběhne jen na základě HTTP 200.

Kolektor, detektor, fronty, parser a AI mají omezené zdroje a oddělené rozpočty.
Porucha jednoho toku má zastavit potřebný nejmenší rozsah, ne vyčerpat celý
server. Jde o princip izolace poruch; návrh má počítat i s cenou a složitostí
takového dělení. [S16]
Dostupnost se neudržuje vypnutím potřebné autorizace. Při ztrátě kritické
společné autority může být správným rozsahem zastavení více aplikací.

Povinné doplnění stávajících provozních testů:
- záplava duplicitních syntetických alertů nemá spustit neomezené zásahy;
- požadavek detektoru na zásah mimo jeho pravomoc se zamítne;
- izolace jednoho cíle neodstaví nesouvisející testovací službu;
- kritická ztráta důvěry nezíská výjimku jen kvůli zachování dostupnosti;
- vypnutí dashboardu nezmění platná lokální bezpečnostní rozhodnutí.
Provede se pouze v izolovaném prostředí podle pravidel kapitoly 5.

### 2.5 Podmínka přehlednosti a praktického dokončení

Není stanoven magický limit řádků, souborů ani počet testů jako důkaz kvality.
Každý soubor v citlivém toku musí mít vysvětlitelnou odpovědnost; reviewer
musí dohledat jednu konkrétní cestu: požadavek -> ověření identity -> oprávnění
k objektu -> provedení operace -> událost -> případná reakce.

Povinné důkazy přehlednosti:
- mapa skutečných závislostí a datových toků souhlasí s implementací;
- žádný klientský stav není nezdokumentovanou bezpečnostní autoritou;
- provozní artefakt neobsahuje testovací obchvat;
- každý kritický zákaz má pozitivní i negativní integrační test;
- změna sdílené kontroly spustí relevantní testy všech jejích dotčených
  spotřebitelů před jejich přijetím; postupný rollout používá připnuté verze;
- dopad na legitimní workflow, čas odpovědi a zdroje je změřen proti předem
  schváleným limitům; zde nejsou žádné takové výsledky předstírány.

Nejdříve ověřit dvě odlišné aplikace a jejich spolupráci. Když integrace
vyžaduje stále nové kopie enginu či nekontrolované výjimky, vrátit se k návrhu
rozhraní, nikoli šířit tuto podobu do celého ekosystému.
Závěr o přehlednosti PROTOKOLU není závěr o přehlednosti neprozkoumaného KÓDU.

## 3. Nepřekročitelné invarianty

### 3.1 Identita a autorizace

Přihlášení není souhlas se všemi akcemi. Každé čtení, zápis, export, stažení,
stream a administrativní operace ověřuje relevantní oprávnění a vlastnictví objektu.
Kontrola zahrnuje také přímé URL, interní volání, alternativní API a práci na pozadí.
Volání mezi aplikacemi zachová identitu služby i rozsah oprávnění uživatele.
Interní původ nezvyšuje oprávnění. [S02]

Práva neplynou z localStorage, skrytého tlačítka ani z klientem dodaného označení role.
Identita od školního poskytovatele musí být ověřená včetně příjemce tokenu,
doby platnosti a zamýšleného účelu. Přístup učitele se řídí schválenou skupinou
nebo registrem, nikoli pouhým výskytem školní domény v neověřeném řetězci.

Revokace má konkrétní maximální prodlevu. Otevřená karta, streaming i rozpracovaná
úloha musí odebrání oprávnění respektovat. Pro privilegované účty požadovat
vícefaktorové přihlášení; pro změnu trust rootu, politiky či nasazení navíc
čerstvé ověření podle profilu. Obnova účtu nesmí obcházet tato pravidla.
U odcizené platné relace nelze spoléhat na firewall; rozhodují oprávnění,
omezení operací, odvolání relace a cílené detekce. [S01, S02]

### 3.2 Politika a výpadky

ALLOW vyžaduje souhlas všech relevantních autorit. Platný DENY kterékoliv
z nich má přednost. Vynechání vrstvy nesmí působit jako její souhlas.

Politika se validuje strukturálně i významově. Chybějící pravidlo, neznámé pole
s bezpečnostním významem, neznámá verze, neúplný inventář nebo placeholder
nesmějí být přijaty jako produkčně platná konfigurace.

Kopie poslední platné podepsané politiky může být dočasně použita jen ve
výslovně definovaném omezeném režimu. Má maximální stáří a nelze jí ignorovat
známou revokaci. Po vypršení se vypne závislá riziková funkce.
Neplatný podpis není totéž jako krátký výpadek spojení.

Výpadek dashboardu nezastaví lokální ochrany. Výpadek poskytovatele AI vypne
AI funkce, nikoli automaticky losování či jiné nezávislé lokální funkce.
Výpadek autorizační služby po skončení povolené platnosti ověření blokuje
chráněné operace. Výpadek logování má omezenou frontu a vlastní eskalaci;
nemá jediným paketem umožnit útočníkovi vypnout celou školu.

### 3.3 AI a aplikační význam výstupů

Model není autorita pro přístup, změnu politiky, nasazení, mazání ani odesílání.
Bezpečnostní rozhodnutí musí vynutit běžný deterministický kód mimo model. [S04]

Testuje se nejen odolnost promptu, ale i stav, kdy model už vyprodukoval
nepřípustný požadavek. Vykonávač jej musí odmítnout. LLM hodnotitel bezpečnosti
může přidat signál, ale nesmí být jediným autorizátorem. [S04, S05]

Každý nástroj má explicitní seznam povolených akcí a validované parametry.
Zakázány jsou obecné vykonávače libovolného příkazu, cesty k souboru či URL
řízené výstupem modelu. Vysoce dopadové akce vyžadují čerstvé potvrzení konkrétního
příjemce, obsahu a rozsahu; obecné předchozí „souhlasím“ nestačí.
Korespondenční asistent nesmí získat právo odeslat zprávu jen z textu dokumentu.

Studentův text, historie konverzace, web, dokument i výstup jiné aplikace
zůstávají nedůvěryhodným obsahem. Při přenosu Diferenciátor -> Generátor/Ludus
musí zůstat původ a původní hranice důvěry, nebo se obsah znovu klasifikuje
jako nedůvěryhodný. Model nesmí sám přidělit důvěryhodný štítek.

Odděleně se hodnotí:
A. jazyková odolnost modelu proti změně úkolu;
B. porušení datové, autorizační či nástrojové hranice;
C. věcná správnost výstupu.
Odmítnutí modelu není důkazem bezpečnosti B. Správné JSON schéma není důkazem C.
U hodnotitele slohů je změna hodnocení instrukcí ve studentském textu samostatný
test integrity úlohy; platný rozsah bodů sám o sobě nestačí.
Citlivé hodnocení potvrzuje učitel, nikoli automatický bezpečnostní score.

### 3.4 AI gateway, odchozí síť a rozpočet

Dětská aplikace nemá klíč poskytovatele ani neomezený přímý přístup na internet.
AI Core kontroluje vlastní identitu volající služby, oprávnění uživatele,
povolený model, tvar požadavku, velikost dat a limity.

Limity jsou současně za uživatele, aplikaci, operaci a celý ekosystém.
Započítávají podvolání, opakování, paralelní požadavky i přerušené operace.
ID operace přiděluje nebo ověřuje server; změna ID nesmí obnovit rozpočet.
Rezervace a účtování limitu musí být atomické i při více instancích.
Timeout a zrušení na frontendu samy o sobě nejsou důkazem ukončení nákladu u providera.
Přípustný rozpočet Generátoru musí vycházet z jeho skutečného vícekrokového toku,
nikoli z nesprávného předpokladu jednoho AI volání na jeden test.

Egress se vynucuje mimo dětskou aplikaci a nezávisle na předpokladu, že školní
perimetrový firewall vždy správně filtruje. Povolený hostname není univerzální
souhlas s libovolným účtem, tenantem, uploadem či cestou u tohoto poskytovatele.
Omezit i účel, metodu a parametry konkrétní integrace.

URL fetchery mají schválené cíle, schémata, porty, redirecty a ověřené DNS/IP
chování. Prověřit IPv4/IPv6, loopback, interní a link-local adresy včetně
změny cíle při přesměrování. Pouhá kontrola textu původní URL nestačí. [S06]
Tvrzení default-deny v JSON není důkazem fungující síťové blokace.

### 3.5 Soubory, data a prohlížeč

Soubor jde nejprve do karantény, ne přímo do parseru a ne do webově přístupné složky.
Omezit velikost, povolené typy, počet položek archivu, hloubku, rozbalený objem,
čas, paměť a CPU. Zamítnout průchody mimo cílový adresář a odkazy vedoucí ven.
Čistý výsledek AV je jen jedna kontrola, nikoli důkaz bezpečnosti dokumentu. [S01]

Parser běží s nejnižšími oprávněními, bez přístupu k produkčním tajným údajům
a bez nepotřebné sítě. Neprovádí makra ani automatické vzdálené načítání.
Pokud profil vyžaduje scanner a ten není dostupný, soubor zůstane v karanténě.
Pro malou aplikaci není nutné budovat vlastní antivirový engine.

Datové přístupy oddělují uživatele, úlohy i aplikace. Stejně se kontroluje
cache, fronta, vyhledávání/RAG a export, nejen primární databáze.
RAG retrieval se autorizuje před přidáním dat do kontextu modelu, nikoli až
filtrováním výsledné odpovědi.

Pro každý typ dat musí být určeno: co se ukládá, proč, kde, kdo k tomu smí,
kdy se maže a jak se zachází se záložní kopií. Obnova zálohy musí respektovat
evidované požadavky na odstranění dat a nesmí tiše obnovit staré přístupy.
Dříve oprávněně stažený export nelze spolehlivě vzdáleně odvolat; proto minimalizace.

HTML/Markdown a modelový výstup se renderují bezpečně. Zvlášť testovat uložené XSS,
náhledy dokumentů, export/import, URL, postMessage a iframe hranice.
Kde je potřeba izolace aplikací proti XSS, samotná jiná URL cesta nestačí:
je třeba odpovídající původ/origin a oddělení cookies a úložišť.
Offline/service-worker režim nesmí znovu zpřístupnit citlivá data po odhlášení
ani ignorovat revokaci jen proto, že má starou cache. [S01]

### 3.6 Release a automatické aktualizace

Stejný neměnný artefakt, který prošel stagingem, se nasazuje do produkce;
v produkci se znovu nesestavuje jiné neověřené vydání.

Ověřovat digest, identitu aplikace, povolený původ, podpis, důvěryhodného vydavatele/
builder, očekávaný repozitář a workflow, vazbu na schválený commit a revokace.
Podpis bez ověření identity a očekávání nestačí. Podpis platného škodlivého
kódu nezaručuje jeho bezpečnost. [S07, S08]

Důvěryhodné klíče a admission politika nesmějí být převzaty pouze ze stejného
neověřeného balíku, který mají ověřit. Aktualizátor nesmí sám sobě rozšířit
seznam důvěryhodných repozitářů. Změny CI, trust rootu a release politiky mají
vyšší schvalování než běžná aplikační změna.

Read token pro zdroj není deploy token. Aplikace nemá ani jeden z privilegovaných
deploy údajů. CI spouštěj bez produkčních tajných údajů na nedůvěryhodném kódu;
povýšené podpisové/nasazovací kroky izolovat od běžných testů.

Aktualizace má stavový automat a trvalý zámek po cílové aplikaci. Duplicitní webhook
je idempotentní; souběžná aktualizace nevytvoří směs verzí. Před přepnutím znovu
ověřit totožnost připraveného artefaktu. Po přepnutí ověřit nejen HTTP 200,
ale identitu vydání a klíčové bezpečnostní invarianty.

COMMITTED lze dosáhnout pouze skutečným provedením povinných bran.
Nestačí vložit objekt s textem PASS. Prázdné/missing gates, nepovolené N/A
a evidence jiného releasu jsou odmítnuty. Historie přechodů musí pocházet
z důvěryhodného aktualizátoru, nikoli z klienta.

Rollback znamená návrat na schválený nerevokovaný artefakt slučitelný s datovým
schématem. Databázová migrace může znemožnit bezpečný jednoduchý rollback;
v takovém případě se použije ověřená obnova nebo předem připravený forward fix.
Anti-rollback a nouzová obnova musejí mít předem vyřešený vztah.

## 4. Povinný postup před releasem

1. INVENTÁŘ A ROZDÍL: přesný commit/artefakt, změněné hranice, endpointy,
   datové toky, závislosti a dopad do ostatních aplikací.
2. STATICKÁ KONTROLA: relevantní lint/type/testy, secrets, závislosti, kontejnery,
   konfigurace a aplikační bezpečnostní analýza. SBOM svázat s artefaktem.
   Selhání scanneru není čistý scan; uvést verzi nástroje, pravidel a stáří databáze.
   Povinnou součástí je architecture-integrity podle 2.3; hodnotí také skutečný
   produkční artefakt, ne pouze umístění souborů ve zdrojovém stromu.
3. TESTY INVARIANTŮ: povolená i zakázaná cesta, různé identity, objekty,
   souběh a alternativní endpointy. Oprava jedné cesty musí pokrýt i ostatní
   volající stejného citlivého místa.
4. STAGING: autentizovaný dynamický test a RED TEAM nad skutečně sestavenou aplikací.
   Prostý scan přihlašovací stránky neprokazuje autorizaci přihlášených uživatelů.
   Pasivní ZAP baseline není plnohodnotný aktivní ani aplikačně specifický audit. [S09]
5. ŘÍZENÉ PORUCHY: kritické závislosti, ochrany a obnova v izolovaném prostředí.
6. REVIEW: ověření závěrů člověkem či odděleným reviewerem; AI review je pomocná
   kontrola, ne náhrada skutečně spuštěných testů a ne certifikace.
7. PODPIS A ADMISSION: svázat kód, konfiguraci, SBOM, testy, pravidla a původ.
8. NASAZENÍ A POST-CHECK: stejný digest, funkčnost i bezpečnost; až poté
   schválený stav vydání. Výsledek je omezen na konkrétní prostředí a scope.

RELEASE STOP:
- porušená kritická hranice, nevyřešený HIGH/CRITICAL v relevantním dosahu;
- chybějící povinný test, chyba harnessu nebo neověřená kritická závislost;
- nemožnost ověřit podpis/původ/cíl nebo neoprávněná změna politiky;
- únik tajného údaje, cizích dat nebo neautorizované vykonání akce;
- nezajištěná obnova stateful změny;
- nevyřešený rozpor mezi schématem, validátorem a normou.

Falešný pozitivní nález lze uzavřít doloženým rozborem; není to obejití brány.
N/A vychází z inventáře a schváleného profilu a musí mít důvod.
Výjimka pro nekritické zbytkové riziko má vlastníka, kompenzaci, lhůtu a revizi.
Výjimka se nezobrazuje jako běžný PASS a nesmí povolit kritické porušení výše.
Výsledek se neprůměruje: 999 úspěchů nespraví jeden únik cizích dat.

Postup navazuje na SSDF: bezpečnost je součást vývoje, buildů, vydání i nápravy,
ne jednorázový sken na konci. [S10]

## 5. RED TEAM: maximální hloubka v kontrolovaném rozsahu

Testování vlastního lokálního balíku nepotřebuje dokládat profesní certifikát.
Aktivní testy školního serveru, infrastruktury nebo externí služby však mají
předem schválený rozsah a pravidla. Vlastnictví aplikace není automatické
oprávnění zatížit cizí API, zasáhnout IdP nebo měnit firewall.

Povinný testovací záznam:
testId, vazba na control, předpoklady, cíl, prostředí, bezpečnostní třída,
syntetické identity/data, očekávaný výsledek, skutečný výsledek, důkaz,
omezení běhu, úklid a ověření návratu do výchozího stavu.

PROD_SAFE není volná licence ke skenování. Vyžaduje konkrétní povolený cíl,
syntetický účet, známé vedlejší účinky a vynucené limity. Neznámý scope nebo
nesplněná podmínka -> NESPUSŤ / NOT_TESTED, nikoli tiché přeskočení do PASS.
Stav měnící, fault-injection, zatěžovací a recovery testy patří do stagingu
nebo jednorázové izolované kopie. Produkční testy nesmějí měnit reálné role či data.

Pro každou kampaň určit maximální počet požadavků, souběh, délku, objem dat,
spotřebu AI a stop podmínky. Orchestrátor smí přijmout pouze známý testId,
nikoli libovolný příkaz. Testy a jejich konfigurace jsou také dodavatelský kód:
verzovat, kontrolovat původ a spouštět s omezenými právy.

Kampaně:
A. identity/objekty: obcházení přihlášení, eskalace, cizí soubory, odvolané relace;
B. web/API: injekce, rendering, CSRF/CORS/origin, importy, parsování, cache;
C. AI: přímá/nepřímá, vícejazyčná, kódovaná, vícekolová, multimodální injekce
   podle skutečně podporovaných vstupů; historie, RAG, cross-app a nástroje;
D. data: únik do jiné relace, logů, provideru, exportu, zálohy či jiné aplikace;
E. release: záměna cíle, podvržený důkaz, replay, revoked artefakt, souběh;
F. runtime: výpadek ochrany, drift, přímý přístup mimo gateway, kompromitovaná app;
G. recovery: izolace, revokace, restore, rollback a obnovení bez vrácení chyby;
H. samotná bezpečnost: falešné PASS, chybějící kontroly, zneužití konzole,
   opakovaná evidence, chybné hodiny a vypnutý kolektor.

Povolené kombinace mají být realistické: např. studentský dokument -> výstup AI
-> export -> import do druhé aplikace -> pokus o zakázanou NOOP akci.
Používat syntetické markery a vlastní testovací cíle, ne krádež skutečných dat.

Test harness musí prokázat, že umí selhat: v jednorázové kopii bezpečně vypnout
testovanou pojistku nebo podstrčit neplatnou fixture, očekávat FAIL, změnu
odstranit a znovu prokázat PASS. Takové mutace nikdy neprovádět v produkci.

AI statistika musí zahrnout počet případů i počet pokusů, model/version,
parametry, chybové odpovědi, timeouty, seed pokud dostupný a uloženou sadu variant.
ASR = úspěšná porušení / skutečně provedené relevantní pokusy; chyby a neprovedené
testy se uvádějí zvlášť. 0 úspěchů v omezené sadě není důkaz nemožnosti útoku.
Ověřit také legitimní kontrolní příklady a podíl nesprávně blokovaných operací.
Část testů držet odděleně od ladění ochran, aby se systém neučil pouze známý corpus.

## 6. Důkazy a pravdivý dashboard

Oddělit čtyři otázky:
PRESENCE — komponenta skutečně přítomna?
HEALTH — je funkční její mechanismus a závislosti?
EFFECTIVENESS — prošla relevantním behaviorálním ověřením?
FRESHNESS — patří důkaz aktuální verzi/prostředí a je dostatečně čerstvý?

Přidat samostatný provozní stav služby. Bezpečně DEGRADED není totéž jako
bezpečnostně FAIL; současně omezenou službu nezobrazovat jako plně zdravou.

Agregátor výsledek vypočítává; nepřijímá klientské overall=PASS jako autoritu.
Množinu povinných komponent a testů získá z důvěryhodného inventáře/profilu,
nikoli ze seznamu, který si aplikace sama libovolně zkrátila.

Důkaz obsahuje:
- appId/componentId; skutečný releaseDigest a identitu prostředí;
- policy/config digest, relevantní závislosti; model/prompt/tool verzi u AI;
- testId, packId/version, identitu runneru a jeho verzi;
- začátek/konec, očekávání, pozorování, stav, scope, omezení a počty;
- integritně ověřitelný sanitizovaný artefakt a vazbu na schválený běh.

Pro živé sondy používat serverem ověřený běh/challenge a monotónní pořadí
s identitou startu procesu. Opakování či důkaz jiného releasu nepovýší čerstvost.
Autentizace evidence ověřuje původ; sama nedokazuje správnost pozorování.
Kritické testy mají navíc nezávislé pozorování na odpovídající hranici.

PASS je přípustný jen při kompletním schváleném scope, platné evidence,
odpovídající verzi a splněné čerstvosti. Sémanticky nemožné kombinace
(např. MISSING + plně účinný aktuální PASS) se odmítnou.
Chybějící důkaz -> NOT_TESTED/UNKNOWN. Chyba runneru -> neověřeno, nikdy PASS.
Přenositelné build důkazy se oddělí od testů vázaných na konkrétní prostředí.

Po změně modelu, promptu, tool schématu, oprávnění, allowlistu, parseru,
policy či nasazení se zneplatní relevantní důkazy podle grafu závislostí.
Starý PASS se může uchovat v historii, ne vydávat za nové ověření.

Kontrola JSON schématu pouze říká „záznam má předepsaný tvar“.
Samostatně je nutné ověřit význam, důvěryhodný původ, vazby a skutečné chování.
Jména nástrojů a jejich výstupy tyto různé úrovně nesmějí směšovat.

## 7. Monitoring, který někdo dokáže provozovat

Všechny služby používají jednotné strukturované události:
čas události i přijetí, eventId, typ, componentId, release/policy digest,
scope, pseudonymní actor/session reference, reasonCode, rozhodnutí,
confidence, severity a korelační ID. Nepoužívat token relace jako korelační ID.

Sledovat hlavně:
- selhání autorizace, neplatnou/odvolanou relaci, zvýšení oprávnění;
- zablokovaný odchozí cíl, neobvyklé exporty, přístup přes jinou app identitu;
- porušení limitu, retry smyčku, přečerpání AI a zpožděné úlohy;
- nevalidní release, drift, porušení trust rootu, použití break-glass;
- výpadek scanneru, autorizační služby, kolektoru, fronty nebo disku;
- chybějící heartbeat, zastaralé důkazy a nedoručený testovací alert.

Události chránit autentizovaným přenosem, omezením velikosti a sanitizací.
Aplikace nesmí přepsat ani smazat externí auditní historii. Samotný lokální
hash chain bez odděleného checkpointu nezaručuje ochranu proti správci hostitele.
Logovací systém sám nesmí způsobit neomezené plnění disku nebo únik dat. [S11]

Do běžných logů nepatří klíče, tokeny, celé studentské práce, prompty, odpovědi
ani surová těla požadavků. Pseudonymní identifikátor není automaticky anonymní.
Případné výjimečné forenzní zachování obsahu vyžaduje oddělené úložiště,
výslovné rozhodnutí, omezený přístup a dobu uchování; není běžným monitoringem.
Ve všech běžných testech používat syntetické studentské údaje, ne skutečné práce.

Každé pravidlo má vlastníka, hrozbu, požadovaný zdroj, podmínku aktivace,
pozitivní i negativní test, reakci, potlačení opakování a recovery.
Pravidlo bez signálu nebo bez jasné reakce není zapnutá ochrana.

Jedna slabá heuristika (např. výuka obsahující text „ignoruj instrukce“)
neblokuje učitele ani celé Studio. Deterministické porušení oprávnění blokuje
konkrétní operaci; nejistá anomálie nejprve vede k záznamu, omezení či step-up.
Duplicitní alerty seskupovat, ale neztratit souhrnný počet událostí.

Provozní návrh frekvencí je v samostatném profilu ke schválení:
startup/post-deploy kontrola; průběžné blokace požadavků; lehký periodický
health; denní syntetická ověřovací sonda; pravidelné staging/recovery kampaně.
Časové cíle jsou návrh, ne naměřené SLA. Bez určeného příjemce a eskalace
nemá alarm provozní hodnotu.

## 8. Reakce na incident a návrat

DETECT -> DECIDE -> CONTAIN -> PRESERVE -> RECOVER.
Tento sled je praktická implementace přípravy, detekce, reakce a obnovy;
využívá principy NIST incident response, ne tvrzení o certifikaci. [S12]

| Událost | Automatická reakce | Návrat |
|---|---|---|
| Cizí objekt/role | Odmítnout operaci, zaznamenat; při vzoru cílený step-up/revokace | Ověřená oprávnění, ne ruční přepsání FAIL |
| Zakázaný AI nástroj či výstup | Nevydat akci/výstup; omezit danou operaci | Platná žádost a revalidovaný vykonávač |
| Scanner nedostupný | Pozastavit zpracování uploadů, zachovat karanténu | Scanner zdravý a soubor znovu ověřen |
| Kompromitovaná child app | Zrušit její service identity/egress, izolovat její běh | Čistý artefakt, nové relevantní credentials, test izolace |
| Neplatná aktualizace | REJECT, zachovat důvěryhodné aktuální vydání | Nový ověřený kandidát |
| Únik update tokenu | STOP_AUTOPATCH, revokace a audit posledních změn | Obnovená důvěra a ověřený aktualizační tok |
| Nedostupný dashboard | Lokální ochrany pokračují, dohled hlásí výpadek | Obnovení čtení; žádné hromadné přidělení PASS |
| Ztráta auditního kanálu | Omezená fronta, alert druhým kanálem; blokace jen vybraných rizikových akcí podle profilu | Ověřený přenos a kontinuita evidence |
| Kompromitovaný centrální trust/host | SAFE_MODE/izolace zvenčí, žádný automatický „self-heal“ na napadeném základu | Čisté prostředí, obnovené klíče, kontrola dopadu a restore |

Závažné zásahy se nesmějí automaticky odvolat jen proto, že útočník opět
vrátil HTTP 200. Recovery potřebuje prokázat čistý stav a příčinu.

Nouzový přístup má nejnižší nutná práva, krátkou platnost, důvod, audit,
upozornění a automatickou expiraci. Bezpečný nouzový režim není vypnutí všech
kontrol. Trust root, vypnutí auditů a povolení neověřeného releasu nejsou
běžné break-glass operace.

Role jsou návrhem k dohodě:
autor/garant vlastní aplikační pravidla, opravy a testy;
IT vlastní infrastrukturní hranice, nasazovací přístupy a provozní zásah;
vedení schvaluje zbytkové riziko a provozní odpovědnost;
pověřená osoba řeší dopad na osobní údaje.
Musí existovat zástup a písemný runbook. Tento dokument nikomu jednostranně
nezadává práci ani nepředpokládá nepřetržitou pohotovost učitele.

## 9. Co záměrně nepřidávat

Nepřidávat vlastní packet firewall, vlastní antivirový engine ani obecný
„AI bezpečnostní mozek“ s neomezeným administrátorským účtem.
Nevytvářet další dashboard bez zdroje důkazů, scan opakující totéž bez přínosu
ani stovky pravidel bez testů a provozního vlastníka.
Neoznačovat přítomný skript, platný JSON, čistý checksum nebo úspěšnou
komunikaci s modelem za důkaz celkové ochrany.

N/A je správné pro neexistující schopnost: aplikace bez uploadu nepotřebuje
antivirový tok; aplikace bez AI nepotřebuje AI-RED. Absenci schopnosti ale
ověřit v kódu, routách a konfiguraci, nikoli jen zaškrtnutím pole.

Upřednostnit existující osvědčené knihovny a jeden vhodný nástroj pro každou
odlišnou kontrolní třídu. Konkrétní výběr se váže na skutečný stack a dosavadní
CI aplikací. Přidání produktu samo o sobě není zvýšení bezpečnosti.

## 10. Stabilní verze, nikoli zastavená údržba

GARP 2.7 označuje stabilní význam hranic, autorit, stavů a kontraktů.
Samostatně se evidují:
- implementační build/patch a digest;
- verze politiky a deployment profilu;
- verze testovacího packu;
- verze detekčních pravidel;
- verze závislostí, providerů a modelových konfigurací.

Nový test, oprava chyby, nový podpis pravidel nebo aktualizace závislosti
nemají automaticky vytvořit GARP 2.8. Změna pravomoci, trust boundary,
významu PASS nebo zpětně nekompatibilní bezpečnostní sémantiky vyžaduje
review kontraktu a případně jeho verzi. Rozšíření allowlistu je bezpečnostní
změna, i když je soubor nazván „config“.

Historické FOUNDATION/SHIELD-LIVE 2.6 a baseline 2.5.1 zachovat jako archivní
východisko. Nové 2.7 moduly nesmějí beze slova vyžadovat garpVersion=2.6.
Přenos starých schémat řešit explicitním kompatibilitním adaptérem a testy,
ne globálním nahrazením řetězců v historických souborech.

Časově omezený pracovní cyklus review není bezpečnostní funkce aplikace.
Pokud se po třech výměnách nepodaří odstranit blokující chybu, kandidát zůstává
blokovaný. Změna organizace dalších oprav nesmí snížit požadavky na důkazy.

## 11. Postup dokončení a freeze gate

A. Opravit potvrzené rozpory a význam validátorů; rozdělit „validní struktura“
   od „ověřená bezpečnostní způsobilost“. Přidat reprodukované negativní případy.
B. Zrevalidovat skutečný stav již existujícího GARP 2.5/N5/release toků.
   Nepsat automaticky znovu to, co je v konkrétních aplikacích funkční.
C. Namapovat architekturu na skutečný kód, zavést bránu podle 2.3.
   Zapojit společné vynucovací body, aplikační autorizaci a minimální adaptér
   v jedné reprezentativní aplikaci. Prokázat povolené i zakázané cesty.
D. Ověřit na schváleném stagingu v cílovém runtime a topologii školy.
   Lokální test na jiné verzi Node není důkazem Node 24/Alpine kompatibility.
E. Ověřit druhou, odlišnou aplikaci a cross-app tok. Prokázat izolaci,
   selhání závislostí, update, alert a obnovu.
F. Teprve poté rozšířit na další relevantní aplikace a přidělovat stavy
   podle skutečného scope; nehromadně přenášet jeden PASS.
G. Nezávislé review, uzavření blokujících nálezů a schválení provozního profilu.
   Až poté označit kontrakt FROZEN a konkrétní nasazení příslušným LIVE stavem.

Kritérium dokončení každé ochrany:
HROZBA -> VLASTNÍK -> VYNUCOVACÍ BOD -> POVOLENÝ TEST -> ZAKÁZANÝ TEST
-> VÝPADEK -> UDÁLOST -> REAKCE -> OBNOVA -> VERZOVANÝ DŮKAZ.

Podkladem pro webové požadavky je OWASP ASVS 5.0.0; cílově pokrýt relevantní L2
a individuálně vybrané vyšší požadavky pro správu, aktualizace a tajné údaje.
To je návrh rozsahu, nikoli tvrzení, že je dnes splněna úroveň ASVS.
Pro audit vytvořit přesnou mapu verzovaných požadavků a jejich evidence.
OWASP Top 10 či jméno standardu samo o sobě není úplný testovací plán. [S01]

## 12. Jak číst přílohy

02-AUDIT-VSTUPNIHO-BALIKU.md = co bylo opravdu zjištěno a spuštěno.
03-RED-TEAM-KATALOG.json = navržené testovací případy; nejde o jejich implementaci.
04-IMPLEMENTACNI-ZADANI.txt = zadání k převodu kontraktu do kódu bez předstíraného PASS.
05-PROVOZNI-PROFIL-KE-SCHVALENI.json = vypnutý návrh parametrů, ne produkční konfigurace.
06-ZDROJE.json = primární veřejné zdroje [S01] až [S16].
08-ZMENY-A-STAV.txt = rozsah této konsolidace a přehled neprovedené implementace.
EVIDENCE/ = původní výstupy lokálních zkoušek, syntetické vstupy a výslovně
označená kontrola konzistence konsolidovaných dokumentů; nejde o runtime PASS.
TOOLS/reproduce_input_audit.py = opakování zkoušek pouze nad přesným původním archivem.

Tento balík sám o sobě nic nenasazuje, nepropojuje repozitáře, neaktivuje monitoring
a nemění nastavení školy. Jeho cílem je dát implementaci jednoznačný a testovatelný
základ místo dalšího souboru nedoložených slibů.
