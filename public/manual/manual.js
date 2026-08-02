const app = document.querySelector('#manual-app');

const sections = [
  ['start', 'Jak začít'],
  ['academic', 'Školní roky a předměty'],
  ['groups', 'Skupiny a jejich historie'],
  ['promotion', 'Postup skupin'],
  ['lessons', 'Plánované a uskutečněné hodiny'],
  ['quick', 'Rychlý zápis a autosave'],
  ['work', 'Úkoly a připomínky'],
  ['reflection', 'Reflexe hodiny'],
  ['tags', 'Štítky'],
  ['materials', 'Knihovna materiálů'],
  ['search', 'Globální vyhledávání'],
  ['templates', 'Šablony a opakované použití'],
  ['cycles', 'Cyklická výuka'],
  ['server-ready', 'Server a synchronizace'],
  ['operations', 'Provoz a serverové zálohy'],
  ['communication', 'Studenti, přílohy a komunikace'],
  ['substitution', 'Zastupování'],
  ['navigation', 'Navigace'],
  ['data', 'Data a zálohy'],
  ['storage', 'Ukládání dat'],
  ['access', 'Přístup a soukromí'],
  ['diagnostics', 'Diagnostika'],
  ['limits', 'Co zatím není hotové'],
];

app.innerHTML = /* qa-safe-html: sections are a fixed internal navigation list */ `
  <header class="manual-topbar">
    <div class="manual-brand">
      <img src="../../src/assets/brand/school-logo.jpg" alt="Logo Gymnázia, Ostrava-Hrabůvka" />
      <div><strong>Lesson Hub</strong><span>Interaktivní manuál · v__APP_VERSION__</span></div>
    </div>
    <div class="manual-actions">
      <button id="manual-theme" type="button" aria-label="Přepnout vzhled">◐</button>
      <a href="../">Zpět do aplikace</a>
    </div>
  </header>
  <div class="manual-layout">
    <aside>
      <label for="manual-search">Hledat v manuálu</label>
      <input id="manual-search" type="search" placeholder="např. postup skupin" />
      <nav>${sections.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav>
      <p class="manual-version">Řízený vývoj · Produkční stabilizace · verze __APP_VERSION__</p>
    </aside>
    <main>
      <section class="manual-hero">
        <span>AI STUDIO GHRAB</span>
        <h1>Lesson Hub</h1>
        <p>Prémiová osobní paměť učitele pro plánování, evidenci, materiály, připomínky a kontinuitu výuky.</p>
      </section>
      <section id="start" data-search="začít spuštění dashboard přehled průvodce první skupina">
        <h2>Jak začít</h2>
        <ol>
          <li>Lesson Hub otevírejte z hlavního rozhraní AI Studia.</li>
          <li>Při prvním spuštění klikněte na <b>Spustit rychlé nastavení</b>.</li>
          <li>V jednom průvodci vytvořte aktuální školní rok, první předmět a první skupinu.</li>
          <li>Další skupiny přidáte v sekci <b>Skupiny</b>. Období a předměty spravujete v části <b>Školní roky a předměty</b>.</li>
        </ol>
        <div class="manual-note">Rychlé nastavení nic neskrývá: všechny vytvořené údaje lze později upravit.</div>
      </section>
      <section id="academic" data-search="školní rok předmět aktuální období archiv správa výuky">
        <h2>Školní roky a předměty</h2>
        <p>Jeden školní rok je označen jako aktuální. Používá se na dashboardu a předvyplňuje se při zakládání skupin. Aktuální rok nelze archivovat, dokud nenastavíte jiný.</p>
        <p>Předmět má název, zkratku a barevný akcent. Předmět používaný aktivní nebo skrytou skupinou nelze archivovat, aby nevznikly neúplné záznamy.</p>
      </section>
      <section id="groups" data-search="skupiny třídy jazyková skupina identita skrýt archivovat smazat detail historie">
        <h2>Skupiny a jejich historie</h2>
        <p>Každá skupina má konkrétní podobu pro jeden školní rok a současně trvalou identitu napříč roky. Změna názvu, ročníku nebo pozdější postup proto nezničí starší historii.</p>
        <div class="manual-grid">
          <article><b>Aktivní</b><p>Skupina se zobrazuje na dashboardu a v hlavním přehledu.</p></article>
          <article><b>Skrytá</b><p>Dočasně není v běžném přehledu, ale lze ji jedním krokem znovu aktivovat.</p></article>
          <article><b>Archivovaná</b><p>Ukončená podoba skupiny zůstává dostupná v historii.</p></article>
          <article><b>Odstraněná</b><p>Definitivní smazání je povoleno jen u prázdné skupiny bez historie a vazeb.</p></article>
        </div>
      </section>
      <section id="promotion" data-search="postup skupin nový ročník převod archivace historie">
        <h2>Postup skupin</h2>
        <ol>
          <li>Nejprve vytvořte cílový školní rok.</li>
          <li>Otevřete <b>Školní roky a předměty</b> a zvolte <b>Spustit postup skupin</b>.</li>
          <li>Vyberte zdrojový a cílový rok.</li>
          <li>U každé skupiny zvolte převod, pouhou archivaci nebo přeskočení.</li>
          <li>Zkontrolujte nové označení a ročník.</li>
        </ol>
        <div class="manual-note">Při převodu vznikne nová podoba stejné trvalé skupiny. Původní podoba se archivuje a zůstane v časové historii.</div>
      </section>
      <section id="lessons" data-search="hodina plánovaná uskutečněná koncept zrušená nedokončená časová osa">
        <h2>Plánované a uskutečněné hodiny</h2>
        <p>Hodinu lze vytvořit jako koncept nebo naplánovanou přípravu. Po zahájení se změní na probíhající a po skončení ji uložíte jako uskutečněnou nebo nedokončenou. Stejný záznam tak plynule přechází z plánu do historie bez přepisování.</p>
        <p>Detail skupiny zobrazuje poslední hodinu, místo, kde se skončilo, nejbližší plán a chronologickou časovou osu.</p>
      </section>
      <section id="quick" data-search="rychlý zápis automatické ukládání autosave během hodiny kde skončilo domácí úkol">
        <h2>Rychlý zápis a automatické ukládání</h2>
        <p>Tlačítko <b>Rychlý zápis</b> vytvoří nebo otevře probíhající hodinu. Průběh, místo ukončení, domácí úkol a poznámka pro příště se průběžně ukládají přímo do lokální databáze.</p>
        <p>Běžný editor plánované hodiny navíc ukládá rozepsaný koncept do prohlížeče. Po nechtěném zavření jej při dalším otevření obnoví.</p>
        <div class="manual-note">Rozpracovaný záznam nezůstává pouze v paměti stránky. Stav uložení je vždy viditelný přímo v editoru.</div>
      </section>
      <section id="work" data-search="povinnosti úkol připomínka termín priorita příští hodina odložit přenést splnit zrušit">
        <h2>Úkoly a připomínky</h2>
        <p>Centrum <b>Povinnosti</b> odděluje otevřené úkoly od připomínek. Úkol vyjadřuje, co je potřeba udělat; připomínka určuje, kdy nebo v jakém kontextu se má daná věc znovu zobrazit.</p>
        <div class="manual-grid">
          <article><b>Úkol</b><p>Může mít termín, prioritu a vazbu na skupinu nebo hodinu. Lze jej splnit, odložit, přenést na příští hodinu nebo zrušit.</p></article>
          <article><b>Připomínka</b><p>Může být bez data, pro konkrétní den nebo pro příští hodinu skupiny. Lze ji splnit, odložit či přenést.</p></article>
        </div>
        <div class="manual-note">Uzavřené záznamy se nemažou automaticky. Pomocí volby <b>Zobrazit uzavřené</b> je lze znovu dohledat v interní historii.</div>
      </section>
      <section id="reflection" data-search="reflexe úspěšnost povedená problematická co fungovalo změnit použít znovu dovednost aktivita úroveň">
        <h2>Reflexe a úspěšnost hodiny</h2>
        <p>U uskutečněné nebo nedokončené hodiny lze rychle označit celkovou úspěšnost a doplnit, co fungovalo, co je potřeba příště změnit a zda má smysl hodinu či aktivitu znovu použít.</p>
        <p>Volitelně lze doplnit typ aktivity, procvičovanou dovednost a cílovou úroveň. Žádné z těchto polí není povinné.</p>
      </section>
      <section id="tags" data-search="štítek tag kategorizace kategorie barva hodina vyhledávání">
        <h2>Osobní štítky</h2>
        <p>Vlastní štítky lze vytvořit v centru Povinnosti a přiřadit k reflexi konkrétní hodiny. Každý štítek má název, kategorii a decentní barevný akcent.</p>
        <p>Štítky se používají také v globálním vyhledávání a filtrování. Archivace štítku zachová jeho dřívější vazby.</p>
      </section>
      <section id="materials" data-search="materiál knihovna odkaz příloha pracovní list poslech video deduplikace propojit hodina skupina archiv">
        <h2>Knihovna materiálů</h2>
        <p>Každý materiál je uložen jako jeden centrální záznam. Tentýž pracovní list, poslech nebo odkaz proto můžete propojit s více skupinami a hodinami bez vytváření zbytečných kopií.</p>
        <div class="manual-grid">
          <article><b>Obsah záznamu</b><p>Název, typ, zdroj, odkaz, popis, soukromá poznámka, viditelnost a informace, zda je materiál určen studentům.</p></article>
          <article><b>Vazby</b><p>Materiál lze současně přiřadit k více skupinám, konkrétním hodinám a osobním štítkům.</p></article>
          <article><b>Deduplikace</b><p>Při opětovném vložení stejného normalizovaného odkazu se použije původní záznam a pouze se doplní nové vazby.</p></article>
          <article><b>Archiv</b><p>Archivace zachová historii i propojení. Materiál lze později obnovit.</p></article>
        </div>
        <div class="manual-warning">Lokální knihovna uchovává odkazy a metadata. Po přihlášení k Lesson Hub Serveru lze podporované binární přílohy uložit na server, propojit je s výukou a stáhnout na jiném zařízení.</div>
      </section>
      <section id="search" data-search="hledat vyhledávání filtr školní rok skupina předmět datum úspěšnost aktivita dovednost materiál">
        <h2>Globální vyhledávání</h2>
        <p>Sekce <b>Hledat</b> prochází hodiny, materiály, úkoly, připomínky a skupiny. Hledání nerozlišuje diakritiku a u výsledku ukazuje jeho typ a výukový kontext.</p>
        <p>Pomocí přepínačů lze zobrazit pouze určitý typ výsledku. Pokročilé filtry umožňují kombinovat školní rok, skupinu, předmět, období, stav hodiny, úspěšnost, typ aktivity, dovednost a typ materiálu.</p>
        <div class="manual-note">Nejlepší výsledky získáte kombinací krátkého významového dotazu a jednoho nebo dvou filtrů. Sémantické AI vyhledávání je plánováno až pro budoucí serverovou verzi.</div>
      </section>
      <section id="templates" data-search="šablona hodina opakovat duplikovat kopírovat povedená oblíbená hromadně skupiny">
        <h2>Šablony a opakované použití</h2>
        <p>Sekce <b>Šablony</b> ukládá opakovaně použitelné struktury hodin. Šablonu lze vytvořit ručně nebo přímo z uskutečněné povedené hodiny.</p>
        <div class="manual-grid">
          <article><b>Použít šablonu</b><p>Vyberte skupinu a datum. Vznikne nový plán, zatímco původní šablona zůstane beze změny.</p></article>
          <article><b>Duplikovat hodinu</b><p>Kopie přenese přípravu a metodické kategorie, nikoli skutečný průběh, reflexi nebo povinnosti.</p></article>
          <article><b>Více skupin</b><p>Jedna šablona může vytvořit samostatné plány pro několik vybraných skupin.</p></article>
          <article><b>Oblíbené</b><p>Šablony a materiály lze označit jako oblíbené a rychleji je dohledat.</p></article>
        </div>
      </section>
      <section id="cycles" data-search="cyklus dovednosti poslech mluvení čtení psaní gramatika týdny skupina plánování">
        <h2>Cyklická organizace výuky</h2>
        <p>Volitelný cyklus střídá vlastní kroky, například poslech, mluvení, čtení, psaní a gramatiku. Každý krok může trvat jeden nebo více týdnů.</p>
        <p>Cyklus se přiřazuje konkrétním skupinám s kotevním datem. Lesson Hub potom na dashboardu, v detailu skupiny a při plánování ukazuje aktuální krok. Skupina bez cyklu funguje beze změny.</p>
      </section>
      <section id="server-ready" data-search="server synchronizace api účet přihlášení role audit konflikt zařízení">
        <h2>Server a synchronizace</h2>
        <p>Sekce <b>Server</b> připojuje lokální Lesson Hub k samostatné Node.js službě. Serverová relace je oddělena od centrálního Access Guardu AI Studia: Access Guard chrání vstup do aplikace, serverová relace chrání synchronizovaná data.</p>
        <div class="manual-grid">
          <article><b>Účty a role</b><p>Server rozlišuje vlastníka, správce, učitele a suplujícího učitele. Vlastník a správce mohou spravovat účty a číst serverový audit.</p></article>
          <article><b>Synchronizace</b><p>Ruční synchronizace nejprve připraví a odešle lokální změny, potom stáhne změny z jiných zařízení.</p></article>
          <article><b>Konflikty</b><p>Pokud existují dvě novější verze stejného záznamu, Lesson Hub nic tiše nepřepíše a vyžádá rozhodnutí mezi lokální a serverovou verzí.</p></article>
          <article><b>Bezpečnost</b><p>Hesla jsou hashována pomocí scrypt, relace mají omezenou platnost a server ukládá audit přihlášení, správy účtů a synchronizace.</p></article>
        </div>
        <div class="manual-warning">Pro skutečné síťové nasazení musí server běžet za HTTPS reverzní proxy. Datový JSON soubor nesmí být uložen ve veřejném webovém kořeni a musí být pravidelně zálohován.</div>
      </section>
      <section id="operations" data-search="provoz server záloha snapshot obnova údržba monitoring kapacita přílohy relace automatické zálohy">
        <h2>Provoz a serverové zálohy</h2>
        <p>Vlastník a správce mají v sekci <b>Server</b> provozní přehled. Vidí velikost databáze a příloh, počet pracovních záznamů, dobu běhu služby, stav automatických snapshotů a historii posledních záloh.</p>
        <div class="manual-grid">
          <article><b>Ruční snapshot</b><p>Jedním krokem se uloží serverový datový soubor i všechny přílohy. Každá záloha má manifest a kontrolní součet.</p></article>
          <article><b>Automatický režim</b><p>Správce jej aktivuje proměnnou prostředí. Server pak vytváří snapshot v nastaveném intervalu a automaticky odstraňuje nejstarší zálohy nad retenční limit.</p></article>
          <article><b>Bezpečná obnova</b><p>Obnovu může spustit pouze vlastník. Před návratem se automaticky vytvoří bezpečnostní snapshot současného stavu.</p></article>
          <article><b>Údržba</b><p>Bezpečná údržba odstraní vypršené relace, zpracuje splatné zprávy a může současně vytvořit nový snapshot.</p></article>
        </div>
        <div class="manual-warning">Po obnově se ukončí všechny serverové relace a uživatelé se musí znovu přihlásit. Zálohovací adresář musí být mimo veřejný webový kořen a ideálně také replikován mimo server.</div>
      </section>
      <section id="communication" data-search="studenti email import komunikace zpráva šablona příloha plánování schválení retence osobní údaje audit">
        <h2>Studenti, přílohy a komunikace</h2>
        <p>Sekce <b>Komunikace</b> obsahuje minimální seznam studentů, serverové přílohy, šablony zpráv, koncepty a retenční nastavení. Není náhradou školního informačního systému ani plnohodnotným e-mailovým klientem.</p>
        <div class="manual-grid">
          <article><b>Import studentů</b><p>Hromadně vložené školní e-mailové adresy se rozdělí, normalizují a zkontrolují proti duplicitám. Jméno odvozené z adresy lze před uložením nebo později upravit.</p></article>
          <article><b>Serverové přílohy</b><p>Podporované soubory se ukládají mimo hlavní JSON databázi. Server hlídá typ, velikost a stejný obsah zbytečně neukládá dvakrát.</p></article>
          <article><b>Koncepty a šablony</b><p>Zpráva může zůstat interní poznámkou či konceptem, čekat na schválení nebo být naplánována. Citlivější obsah se automaticky nepovažuje za schválený.</p></article>
          <article><b>Audit a retence</b><p>U zpráv se uchovává autor, příjemci, stav a časové údaje. Retenční výmaz vždy nejprve zobrazí náhled a teprve potom lze změnu potvrdit.</p></article>
        </div>
        <div class="manual-grid">
          <article><b>Skutečné odesílání</b><p>Server podporuje SMTP adaptér i bezpečný souborový režim pro pilotní testy. Každému studentovi se vytváří samostatná zásilka, takže příjemci navzájem nevidí své adresy.</p></article>
          <article><b>Plánovač a opakování</b><p>Naplánované zprávy zpracovává serverový plánovač. Dočasně neúspěšné zásilky lze automaticky nebo ručně opakovat do nastaveného maxima pokusů.</p></article>
          <article><b>Doručenky</b><p>U každého příjemce je veden samostatný stav, počet pokusů, čas odeslání, poskytovatel a poslední chyba. Souhrn zprávy rozlišuje úspěšné, čekající a neúspěšné zásilky.</p></article>
          <article><b>Tajné údaje</b><p>SMTP heslo ani další tajné hodnoty se nikdy neukládají do klientské aplikace. Server je načítá výhradně z proměnných prostředí.</p></article>
        </div>
        <div class="manual-warning">Před ostrým SMTP provozem ověřte odesílatele, SPF/DKIM/DMARC, limity školního poskytovatele a doručování na testovací adresy. Souborový režim je určen pro bezpečný pilot bez odeslání do internetu.</div>
        <div class="manual-note">Při testování a sdílení snímků vždy používejte anonymizované studenty. Ukládejte pouze údaje nezbytné pro organizaci výuky.</div>
      </section>
      <section id="substitution" data-search="zastupování suplování nepřítomnost plán období soukromí suplující učitel import historie">
        <h2>Režim zastupování</h2>
        <p>Sekce <b>Zastupování</b> umožňuje nepřítomnému učiteli připravit omezené podklady pro vybrané skupiny. Soukromý zápisník zůstává neveřejný a suplující účet vidí pouze aktivní období, plány a položky výslovně určené k zastupování.</p>
        <div class="manual-grid">
          <article><b>Období</b><p>Učitel vytvoří dobu nepřítomnosti, popis a stav. Teprve aktivní období se zobrazí oprávněným suplujícím učitelům.</p></article>
          <article><b>Plány</b><p>Pro skupinu lze vytvořit plán po jednotlivých hodinách nebo pro širší časový úsek a doplnit veřejné pokyny.</p></article>
          <article><b>Průběh suplování</b><p>Suplující učitel označí splněno, částečně splněno, nesplněno nebo upraveno a zapíše, kde studenti skončili.</p></article>
          <article><b>Návrat učitele</b><p>Vlastník období zkontroluje výsledek a vybrané položky převede do osobní časové osy jako suplované hodiny.</p></article>
        </div>
        <div class="manual-warning">Do zastupovacího plánu nevkládejte soukromé poznámky ke studentům. Server při sdíleném pohledu odstraňuje interní poznámky, přesto má být obsah od počátku omezen na nezbytné výukové informace.</div>
      </section>
      <section id="navigation" data-search="navigace přehled skupiny plán materiály hledat více">
        <h2>Navigace</h2>
        <div class="manual-grid">
          <article><b>Přehled</b><p>Dnešní hodiny, položky vyžadující pozornost, nejbližší plán a rychlý vstup do skupin.</p></article>
          <article><b>Skupiny</b><p>Funkční správa aktivních, skrytých a archivovaných skupin.</p></article>
          <article><b>Plán</b><p>Koncepty, budoucí hodiny, probíhající výuka i uskutečněná historie.</p></article>
          <article><b>Povinnosti</b><p>Otevřené úkoly, připomínky, uzavřená historie a správa osobních štítků.</p></article>
          <article><b>Materiály</b><p>Centrální knihovna odkazů a metadat s oblíbenými položkami, vazbami a hromadnými operacemi.</p></article>
          <article><b>Šablony</b><p>Opakovaně použitelné hodiny, cyklická výuka a hromadné plánování.</p></article>
          <article><b>Hledat</b><p>Globální hledání v hodinách, materiálech, povinnostech a skupinách s pokročilými filtry.</p></article>
          <article><b>Server</b><p>Serverová relace, účty, synchronizace, konflikty, audit, monitoring, provozní snapshoty a obnova.</p></article>
          <article><b>Komunikace</b><p>Studenti, přílohy, šablony, plánované zprávy, skutečné odesílání, doručenky a retenční pravidla.</p></article>
          <article><b>Zastupování</b><p>Období nepřítomnosti, bezpečně sdílené plány, průběh suplování a převzetí výsledků do historie.</p></article>
          <article><b>Více</b><p>Správa výuky, archiv, data a zálohy, nastavení a diagnostika.</p></article>
        </div>
      </section>
      <section id="data" data-search="data záloha export import obnova bod obnovy json kontrolní součet sha-256">
        <h2>Data a zálohy</h2>
        <p>Sekce <b>Data a zálohy</b> umožňuje stáhnout úplný export databáze, bezpečně načíst starší export a vytvářet lokální body obnovy před významnými změnami.</p>
        <div class="manual-grid">
          <article><b>Úplný export</b><p>Jeden JSON soubor obsahuje skupiny, hodiny, materiály, povinnosti, štítky a uživatelské nastavení.</p></article>
          <article><b>Kontrola souboru</b><p>Před importem se ověří formát, verze a kontrolní součet SHA-256.</p></article>
          <article><b>Nahradit data</b><p>Současná databáze se nahradí obsahem exportu. Nejdřív automaticky vznikne bezpečnostní bod obnovy.</p></article>
          <article><b>Sloučit data</b><p>Záznamy se stejným ID se aktualizují, ostatní současná data zůstanou zachovaná.</p></article>
        </div>
        <div class="manual-warning">Lokální bod obnovy zůstává ve stejném prohlížeči. Pro ochranu při poruše zařízení nebo smazání dat ukládejte stažený export také mimo počítač.</div>
      </section>
      <section id="storage" data-search="ukládání indexeddb local first lokální záloha prohlížeč">
        <h2>Ukládání dat</h2>
        <p>Lesson Hub používá jako hlavní lokální úložiště IndexedDB. Datová vrstva je oddělena repository rozhraním, aby ji bylo možné později nahradit serverovou synchronizací.</p>
        <div class="manual-warning">Smazání dat prohlížeče může znamenat ztrátu údajů. Používejte úplný export a uchovávejte jej mimo zařízení.</div>
      </section>
      <section id="access" data-search="přístup soukromí guard permit ai studio osobní údaje">
        <h2>Přístup a soukromí</h2>
        <p>Aplikace je chráněna centrálním Access Guardem AI Studia. Při selhání ověření se nespustí pracovní datová vrstva. Všechny pracovní údaje jsou ve výchozím stavu soukromé.</p>
        <p>Studio Bridge přijímá pouze materiály schématu <code>ghrab-material-v1</code> určené pro <code>lesson-hub</code>. Handoff nesmí obsahovat osobní údaje studentů.</p>
      </section>
      <section id="diagnostics" data-search="diagnostika self test test lab databáze schéma migrace skupina školní rok předmět">
        <h2>Diagnostika</h2>
        <p>Správce může v aplikaci otevřít Test Lab. Kontroluje inicializaci, schéma databáze, čtení a zápis, migrace, centrální přístup, PWA, Studio Bridge, akademické a lekční jádro, povinnosti, materiály, šablony, cykly, studenty, komunikační koncepty, serverové přílohy, doručenky, stav poštovní brány, zastupovací období a plány, konflikty, připojení, export, kontrolní součet, lokální bod obnovy, kapacitu úložiště a integritu vazeb. Výsledek lze stáhnout jako JSON protokol.</p>
      </section>
      <section id="limits" data-search="omezení není hotové vlna 3 hodiny plán připomínky materiály">
        <h2>Co zatím není hotové</h2>
        <p>Verze __APP_VERSION__ obsahuje účty, ruční synchronizaci, serverové přílohy, komunikaci, SMTP nebo souborové odesílání, plánovač, doručenky, audit, retenční pravidla, zastupování, provozní monitoring a serverové snapshoty s kontrolovanou obnovou. Zatím chybí automatická synchronizace na pozadí, napojení na konkrétní školní SMTP službu v distribuovaném balíčku a externě spravované hostování s dohledem infrastruktury.</p>
      </section>
      <footer>
        <span>Vlastník aplikace: Daniel Baláž · Gymnázium, Ostrava-Hrabůvka</span>
        <span>© 2026 Daniel Baláž. Všechna práva vyhrazena.</span>
      </footer>
    </main>
  </div>`;

document.documentElement.dataset.ghrabAccess = 'granted';
document.body.style.visibility = 'visible';

const search = document.querySelector('#manual-search');
search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase('cs-CZ');
  document.querySelectorAll('main section:not(.manual-hero)').forEach((section) => {
    const text = `${section.textContent} ${section.dataset.search || ''}`.toLocaleLowerCase('cs-CZ');
    section.hidden = Boolean(query) && !text.includes(query);
  });
});

document.querySelector('#manual-theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
});
