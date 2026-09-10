# Lesson Hub 1.2.22 — Deployment Security (school-server design)

Stav: **SHIELD-LIVE NOT TESTED**. Dokument je závazný návrh pro staging/produkci, nikoli důkaz reálného nasazení.

## Gateway / auth boundary
- Node listener má zůstat pouze na loopback/private service network; veřejný klient nesmí mít přímou cestu k Lesson Hub backendu mimo centrální gateway.
- `LESSON_HUB_GHRAB_UPSTREAM_SECRET` je volitelný pouze tak, že proměnná není vůbec nastavena. Jakmile je nastavena, musí mít high-entropy 256bit tvar: přesně 64 hex znaků nebo 43–86 base64url znaků s dostatečnou rozmanitostí; placeholder, slabá nebo prázdná hodnota zastaví start fail-closed.
- Secret generovat **výhradně CSPRNG** (např. `openssl rand -hex 32`) a předávat pouze secret storem/protected environment; shape validace není důkaz skutečné entropie. Nikdy ne source, frontendem ani deployment ZIPem.
- Gateway/reverse proxy **musí odstranit všechny klientem dodané `x-ghrab-*` hlavičky** před vložením vlastních hodnot. Zejména `x-ghrab-upstream-secret`, `x-ghrab-user-id`, `x-ghrab-user-name`, `x-ghrab-user-roles`, `x-ghrab-session-expires-at`.
- Nepodepsaná `x-ghrab-user-roles` může mapovat pouze `teacher`/`substitute`; nesmí vytvořit `owner` ani `admin`.
- Účet `authSource=ghrab-sso` nelze přes správní API povýšit na `owner/admin`. Historický privilegovaný SSO záznam je při upstream autentizaci fail-closed odmítnut. Privilegované role jsou v tomto mezistavu pouze pro lokální účty.
- E-mailová SSO identita musí být kanonický ASCII e-mail. Plus-tag, trailing-dot, Unicode/confusable nebo jiný nekánonický tvar se odmítne; case/whitespace se kanonizují před identity hashem. Kolize s lokálním účtem končí 409.
- `x-ghrab-session-expires-at` musí být platný budoucí čas v bounded okně; invalid/past/unbounded tvrzení končí 401.
- SSO účet je **gateway-only**: local password login jej nesmí autentizovat a správní API mu nesmí přidat lokální heslo. Offboarding SSO = `status=disabled`.
- Pro **LIVE** se nadále doporučuje podepsaná identita/JWS s audience+exp nebo mTLS mezi Gateway a Lesson Hubem. 1.2.22 tuto kryptografickou identitu nepředstírá; N15 je uzavírán konzervativní interim politikou „privilegované role pouze lokálně“.

## Runtime / filesystem
- Node 22+ pod neprivilegovaným účtem; read-only aplikační kód, zápis jen do dat/backup/temp adresářů.
- Jeden Node proces je pilotní režim; širší/multi-process provoz vyžaduje databázovou migraci dle capacity politiky.

## Síť / proxy
- Externě pouze HTTPS přes školní reverse proxy; same-origin frontend/API.
- Egress default-deny; Lesson Hub nemá AI/provider egress. SMTP povolit jen explicitně.
- CSP, TLS a security headers ověřit nad skutečně servírovanou aplikací před LIVE.

## Data / backup / logging
- Backup/restore zachovává normalizaci a fail-closed freeze; retention/rotation/restore SOP ověřit před reálnými studentskými daty.
- Logy/audit nesmí nést raw failed-login e-mail, studentské canary ani secrety.
- N6/LH-D27: suite-session generation signal je na shared originu stále nepodepsaný. Jeho samostatné riziko je nechtěný destruktivní cleanup; proti XSS na stejném originu nepřidává novou schopnost, protože origin už může přistoupit k IndexedDB/localStorage. Reálná data zůstávají blokována širším SIM-01/LIVE stavem.

## Supply chain
- `package.json` a kořen lockfile musí být obousměrně shodné; všechny lock záznamy musí být dosažitelné z deklarovaných závislostí. `resolved` musí být HTTPS na `registry.npmjs.org`, bez userinfo, alternativního portu, query, fragmentu ani percent-encoded package path, a musí přesně odpovídat package/version; integrity musí být SHA-512.
- GitHub workflow musí mít top-level pouze `contents: read`. Write scope je povolen pouze přesně v `deploy` jobu; `write-all`, `pull_request_target`, plovoucí runner/Node/action ref, remote download→shell, `<(curl|wget ...)`, sourcing process substitution, `eval` i PowerShell `iwr/Invoke-WebRequest | iex/Invoke-Expression` jsou zakázány fail-closed kontrolou.
- Secret scanning zdroje i deploymentu používá sdílenou kanonickou detekční vrstvu. Privátní key material nesmí být allowlisted. Base64/base64url a hex se bounded rekurzivně dekódují; ZIP/JAR stored/deflate entries se skenují in-memory; nečitelný/šifrovaný/nadlimitní archiv je fail-closed. Lowercase nekotované hodnoty pod citlivými klíči v YAML/INI/.properties/Compose/env jsou rovněž kontrolovány; obvious placeholdery a environment-variable reference nejsou vydávány za reálný secret.

## Release integrity
- Podepsaný PREP artefakt se vztahuje na `dist-school-server`, nikoli automaticky na GitHub Pages `dist/`.
- Exact source identita PREP buildu je hash frozen source ZIPu (`sourcePackageSha256`). Historický Git commit 5dc8db114561c0d3696e71003eb1a1d71c7e846c je pouze `baseCommit`, nikoli exact `sourceCommit` 1.2.22.
- Před aktivací school-server artefaktu ověřit RI manifest, Ed25519 signature, trust root a registry.
- Kritické assety musí zůstat network-only/no-store a mimo precache.
- Produkční signing private key nesmí být na web serveru ani v repo; PREP key je disposable.
- PREP registry není sama autentizovaná; RI-LIVE vyžaduje podepsaný/append-only registry mechanismus a provozní custody/rotation/recovery.

## LIVE exit criteria
DAST/served headers, TLS/proxy, auth/session/revokace, klient-header stripping, kryptografická gateway identita nebo ekvivalentní trust mechanismus, rate/resource enforcement, backup recovery, production key custody/rotation/recovery, registry protection, alert/watchdog a incident drill musí mít samostatnou LIVE evidenci.
