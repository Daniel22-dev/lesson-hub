# Lesson Hub 1.1.6 – pilotní checklist

## GitHub a klientská aplikace

- [ ] repozitář se jmenuje přesně `lesson-hub`
- [ ] soubory jsou nahrané přímo do kořene repozitáře
- [ ] výchozí větev je `main`
- [ ] GitHub Pages používá zdroj **GitHub Actions**
- [ ] workflow dokončilo `npm ci`, `npm audit`, QA, build a deploy
- [ ] `https://daniel22-dev.github.io/lesson-hub/manifest.webmanifest` vrací HTTP 200
- [ ] stejný nasazený build prošel ručním smoke testem

## Local-first pilot

- [ ] aplikace se spustí bez připojeného serveru
- [ ] IndexedDB je aktivní a nezobrazuje se varování o dočasné paměti
- [ ] vytvoření školního roku, skupiny a hodiny funguje
- [ ] automatické ukládání a obnovení konceptu funguje
- [ ] úplný export byl stažen
- [ ] import a obnova byly ověřeny na anonymizované kopii
- [ ] PWA nabídne aktualizaci nové verze
- [ ] Test Lab neobsahuje kritický nález

## Soukromí

- [ ] při pilotu se používají anonymizovaní studenti
- [ ] do aplikace se nevkládají kázeňské, zdravotní ani jiné citlivé profily
- [ ] exporty jsou uloženy v chráněném umístění
- [ ] serverové funkce, SMTP a skutečné kontakty zůstávají vypnuté

## Budoucí serverová infrastruktura

- [ ] Node.js 22 a samostatný účet služby
- [ ] HTTPS reverzní proxy
- [ ] přesný CORS allowlist
- [ ] datové cesty mimo webový kořen
- [ ] automatické snapshoty výslovně aktivované
- [ ] externí kopie záloh mimo server
- [ ] test obnovy v izolovaném prostředí
- [ ] SMTP tajné údaje pouze v tajném úložišti
- [ ] role a omezené zastupování ověřeny
