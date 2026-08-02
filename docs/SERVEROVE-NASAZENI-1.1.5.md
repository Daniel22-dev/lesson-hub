# Lesson Hub Server 1.1.5 – produkční stabilizace

## Rozsah

Verze 1.1.5 zachovává provozní funkce 1.1.2 a opravuje GitHub QA spuštění. Serverová část nadále rozšiřuje server 1.0.0 o provozní monitoring, ruční a automatické snapshoty, kontrolovaný návrat ze zálohy a správní údržbu. Nemění model vlastnictví dat ani klientské schéma IndexedDB.

## Doporučené cesty

```text
/opt/lesson-hub/app                 zdrojový projekt
/var/lib/lesson-hub/server.json     serverová databáze
/var/lib/lesson-hub/attachments     přílohy
/var/lib/lesson-hub/outbox          souborový e-mailový pilot
/var/lib/lesson-hub/backups         provozní snapshoty
```

Všechny datové cesty musí být mimo veřejný webový kořen, vlastněné účtem serverové služby a nepřístupné běžným uživatelům operačního systému.

## Minimální prostředí

```bash
export LESSON_HUB_SERVER_HOST=127.0.0.1
export LESSON_HUB_SERVER_PORT=8787
export LESSON_HUB_SERVER_DATA=/var/lib/lesson-hub/server.json
export LESSON_HUB_ATTACHMENTS_DIR=/var/lib/lesson-hub/attachments
export LESSON_HUB_BACKUP_DIR=/var/lib/lesson-hub/backups
export LESSON_HUB_ALLOWED_ORIGINS=https://ai-studio.example.edu
export LESSON_HUB_BACKUP_ENABLED=true
export LESSON_HUB_BACKUP_INTERVAL_HOURS=24
export LESSON_HUB_BACKUP_RETENTION=30
```

SMTP tajné hodnoty nastavte samostatně v chráněném prostředí služby. Nikdy je nevkládejte do klienta, repozitáře nebo dokumentace.

## Snapshot

Každý snapshot obsahuje:

- `store.json` – konzistentní serverový datový soubor;
- `attachments/` – kopii serverových příloh;
- `manifest.json` – čas, důvod, verzi, počty, velikosti a SHA-256 databáze.

Před vytvořením snapshotu server dokončí aktuální zápis databáze. Nejstarší snapshoty nad retenční limit se automaticky odstraní.

## Obnova

Obnovu může provést pouze vlastník serveru.

1. server ověří manifest a SHA-256;
2. vytvoří snapshot současného stavu s důvodem `pre-restore`;
3. nahradí databázi a přílohy vybranou zálohou;
4. znovu otevře datové úložiště;
5. ukončí všechny serverové relace;
6. zapíše auditní událost.

Po obnově se všichni uživatelé musí znovu přihlásit. Následně ověřte health endpoint, počty záznamů, přílohy, synchronizaci a zpracování testovací zprávy.

## Externí kopie

Snapshoty na stejném disku nechrání proti poškození serveru, šifrovacímu útoku ani ztrátě zařízení. Doporučeno:

- denní replikace zálohovacího adresáře na jiné úložiště;
- šifrování zálohy při přenosu i v klidu;
- oddělené přístupové údaje;
- kontrola stáří poslední externí kopie;
- čtvrtletní test obnovy v izolovaném prostředí.

## Monitoring

Správní API poskytuje:

- uptime a verzi Node.js;
- velikost databáze a příloh;
- počet aktivních uživatelů a relací;
- počet synchronizačních změn a auditních událostí;
- počty datových zdrojů;
- stav automatického zálohování a poslední snapshot;
- výsledek poslední ruční údržby.

Absolutní serverové cesty ani tajné SMTP údaje se klientovi nevracejí.

## Pilotní ověření

Před prací se skutečnými údaji:

1. nasaďte klienta a server za HTTPS;
2. vytvořte testovací účty bez skutečných studentů;
3. ověřte ruční snapshot;
4. vytvořte testovací záznam a přílohu;
5. proveďte obnovu a ověřte návrat stavu;
6. potvrďte ukončení starých relací;
7. zkontrolujte externí kopii snapshotu;
8. spusťte test synchronizace a souborový e-mailový pilot;
9. teprve potom povolte omezený školní pilot.

## Bezpečnostní opravy 1.1.2

- obnova serveru používá provozní zámek a zneplatňuje relace;
- SMTP vyžaduje TLS ve výchozím stavu (`LESSON_HUB_SMTP_REQUIRE_TLS=true`);
- automatické snapshoty jsou při vypnutí výrazně hlášeny;
- heslo prvního správce se načítá pouze z `ADMIN_PASSWORD`;
- sdílené záznamy jsou pro jiné učitele pouze ke čtení.
