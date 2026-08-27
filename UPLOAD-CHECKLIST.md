# Nahrání Lesson Hubu 1.2.3 na GitHub

Nahrajte obsah této složky přímo do kořene repozitáře `lesson-hub`.

Před potvrzením commitu zkontrolujte, že výběr obsahuje také:

- `.github/workflows/deploy.yml`
- `.gitignore`
- `.nvmrc`
- `.env.example`

Bez `.github/workflows/deploy.yml` se certifikace a GitHub Pages nespustí.

Po nahrání otevřete **Actions → Certifikace a nasazení Lesson Hubu**. Verze musí být v `package.json` uvedena jako `1.2.3`.

## Po úspěšném nasazení

1. Ověřte `https://daniel22-dev.github.io/lesson-hub/studio-manifest.json`.
2. Ověřte `https://daniel22-dev.github.io/lesson-hub/manual/`.
3. Teprve potom nahrajte AI Studio GHRAB 0.19.0, aby synchronizace načetla Lesson Hub 1.2.3.
