# Lesson Hub 1.2.3 – reportér chyb

Verze 1.2.3 zachovává kanonický GHRAB Error Reporter 1.1.0 a neblokující načítání adaptéru mimo start hlavní aplikace. Manuál odkazuje na centrální návod, service worker cachuje lokální komponenty reportéru a Studio i samostatné spuštění smějí vytvořit právě jednu lokální instanci.

Statické testy ověřují zkrácení finální Gmail URL, focus trap, obnovu fokusu, nový reportId, sanitizaci a bezpečný diagnostický balíček. Browserovou část je nutné dokončit v CI bez spravované politiky Chromium `URLBlocklist`.
