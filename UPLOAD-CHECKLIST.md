# Nahrání Lesson Hubu 1.1.4 na GitHub

Nahrajte obsah této složky přímo do kořene repozitáře `lesson-hub`.

Před potvrzením commitu zkontrolujte, že výběr obsahuje také:

- `.github/workflows/deploy.yml`
- `.gitignore`
- `.nvmrc`
- `.env.example`

Bez `.github/workflows/deploy.yml` se certifikace a GitHub Pages nespustí.

Po nahrání otevřete **Actions → Certifikace a nasazení Lesson Hubu**. Opravená verze má v `package.json` číslo `1.1.4`.

- Po neúspěšném běhu stáhněte QA artefakt; verze 1.1.4 vypisuje konkrétní scénář a důkaz bez hodnoty `undefined`.
