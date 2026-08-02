# Lesson Hub Server 1.2.0

Server používá pouze standardní knihovny Node.js 22. Poskytuje účty, role, relace, auditní historii, obecné REST zdroje, obousměrnou synchronizaci, binární přílohy, skutečné zpracování naplánovaných zpráv a režim zastupování.

## První spuštění

```bash
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run server:init -- --name="Správce"
npm run server:start
```

Výchozí adresa je `http://127.0.0.1:8787`. Pro síťové nebo produkční nasazení použijte HTTPS reverzní proxy, přesný seznam povolených originů a vlastní chráněné datové cesty.

## Základní proměnné prostředí

- `LESSON_HUB_SERVER_HOST`
- `LESSON_HUB_SERVER_PORT`
- `LESSON_HUB_SERVER_DATA`
- `LESSON_HUB_ATTACHMENTS_DIR`
- `LESSON_HUB_ALLOWED_ORIGINS`
- `LESSON_HUB_SESSION_HOURS`
- `LESSON_HUB_BODY_LIMIT`
- `LESSON_HUB_ATTACHMENT_LIMIT`
- `LESSON_HUB_LOGIN_WINDOW_MS`
- `LESSON_HUB_LOGIN_ATTEMPTS`

## Poštovní brána

Režim určuje `LESSON_HUB_MAIL_MODE`:

- `disabled` – zprávy se neposílají;
- `file` – každá zásilka se uloží jako samostatný `.eml` soubor do lokálního outboxu; vhodné pro pilotní test;
- `smtp` – skutečné odeslání přes SMTP.

Společné nastavení:

- `LESSON_HUB_MAIL_FROM`
- `LESSON_HUB_MAIL_REPLY_TO`
- `LESSON_HUB_MAIL_OUTBOX_DIR`
- `LESSON_HUB_MAIL_SCHEDULER`
- `LESSON_HUB_MAIL_INTERVAL_MS`
- `LESSON_HUB_MAIL_MAX_ATTEMPTS`
- `LESSON_HUB_MAIL_RETRY_MINUTES`

SMTP nastavení:

- `LESSON_HUB_SMTP_HOST`
- `LESSON_HUB_SMTP_PORT`
- `LESSON_HUB_SMTP_SECURE`
- `LESSON_HUB_SMTP_STARTTLS`
- `LESSON_HUB_SMTP_USER`
- `LESSON_HUB_SMTP_PASSWORD`
- `LESSON_HUB_SMTP_HELO`

Tajné údaje nastavujte pouze v prostředí serveru nebo v bezpečném správci tajemství. Nikdy je nevkládejte do klientského buildu, Git repozitáře, dokumentace ani exportu Lesson Hubu.

### Bezpečný pilot bez odeslání do internetu

```bash
export LESSON_HUB_MAIL_MODE=file
export LESSON_HUB_MAIL_FROM='$TEST_MAIL_FROM'
export LESSON_HUB_MAIL_OUTBOX_DIR='/var/lib/lesson-hub/outbox'
npm run server:start
```

V tomto režimu vzniknou kontrolovatelné `.eml` soubory. Adresy příjemců se navzájem neodhalují, protože server vytváří samostatnou zásilku pro každého příjemce.

### SMTP příklad

```bash
export LESSON_HUB_MAIL_MODE=smtp
export LESSON_HUB_MAIL_FROM='$SCHOOL_MAIL_FROM'
export LESSON_HUB_SMTP_HOST='smtp.school.example'
export LESSON_HUB_SMTP_PORT=587
export LESSON_HUB_SMTP_STARTTLS=true
export LESSON_HUB_SMTP_USER='lesson-hub'
export LESSON_HUB_SMTP_PASSWORD='*** pouze v tajném úložišti ***'
npm run server:start
```

Před ostrým provozem ověřte SPF, DKIM, DMARC, limity poskytovatele a doručování na testovací adresy.

## Zpracování zpráv

- plánovač pravidelně vyhledává splatné zprávy;
- citlivá zpráva zůstává ve stavu vyžadujícím schválení;
- každý příjemce má samostatnou doručenku;
- dočasná chyba přechází do řízeného opakování;
- po překročení maxima pokusů je zásilka označena jako neúspěšná;
- audit zaznamenává zpracování, výsledek a ruční opakování.

Serverový stav poštovní brány vrací pouze ne-tajné informace. Heslo ani autentizační token SMTP se přes API neposílají.

## Režim zastupování

- vlastník vytvoří období nepřítomnosti;
- pro vybrané skupiny připraví plány a položky;
- suplující účet vidí pouze aktivní období a veřejné části plánu;
- soukromé poznámky učitele se ve sdíleném pohledu nevracejí;
- suplující učitel zapíše stav, průběh a místo ukončení;
- po návratu vlastník vybrané položky převede do osobní historie jako suplované hodiny.

Do zastupovacích podkladů nevkládejte osobní nebo kázeňské poznámky o studentech.

## Funkce verze 1.1.2

- účty a role `owner`, `admin`, `teacher`, `substitute`;
- scrypt hashování hesel a časově omezené bearer relace;
- synchronizační protokol `lesson-hub-sync-v1`;
- binární přílohy mimo hlavní JSON databázi;
- deduplikace příloh podle kontrolního součtu;
- skutečný SMTP nebo souborový odesílací adaptér;
- plánovač, opakované pokusy a doručenky po příjemcích;
- režim zastupování s omezeným pohledem;
- retenční politika a náhled výmazu;
- audit přihlášení, účtů, synchronizace, komunikace, příloh, retence a zastupování.

Datový soubor, adresář příloh i outbox mohou obsahovat pracovní nebo osobní údaje. Musí být mimo veřejný webový kořen, chráněné oprávněními operačního systému, pravidelně zálohované a zahrnuté do testu obnovy.

## Provozní monitoring a snapshoty 1.1.2

Vlastník a správce mají v klientské sekci **Server** přístup k provoznímu stavu. Server vrací pouze netajné informace: dobu běhu, velikost databáze, velikost a počet příloh, počty pracovních záznamů, relací a snapshotů.

Proměnné prostředí:

- `LESSON_HUB_BACKUP_DIR` – chráněný adresář snapshotů;
- `LESSON_HUB_BACKUP_ENABLED` – `true` aktivuje automatické snapshoty;
- `LESSON_HUB_BACKUP_INTERVAL_HOURS` – interval, výchozí 24 hodin;
- `LESSON_HUB_BACKUP_RETENTION` – počet uchovaných snapshotů, výchozí 14;
- `LESSON_HUB_OPERATIONS_INTERVAL_MS` – interval kontroly plánovače, minimálně 60 sekund.

Doporučené produkční nastavení:

```bash
export LESSON_HUB_BACKUP_DIR='/var/lib/lesson-hub/backups'
export LESSON_HUB_BACKUP_ENABLED=true
export LESSON_HUB_BACKUP_INTERVAL_HOURS=24
export LESSON_HUB_BACKUP_RETENTION=30
```

Snapshot obsahuje serverový JSON datový soubor, přílohy, manifest a SHA-256 kontrolní součet. Obnovu může spustit pouze role `owner`. Před obnovou server automaticky vytvoří snapshot současného stavu a po návratu ukončí všechny relace.

Snapshot ve stejném serveru není úplná disaster-recovery strategie. Zálohovací adresář pravidelně replikujte na jiné úložiště a alespoň čtvrtletně provádějte test obnovy v odděleném prostředí.

> Automatické snapshoty jsou ve výchozím stavu vypnuté. Pro ostrý provoz nastavte `LESSON_HUB_BACKUP_ENABLED=true`; jinak server vypíše varování. SMTP přihlášení je ve výchozím stavu povoleno pouze přes aktivní TLS.
