# Release / upload checklist — Lesson Hub 1.2.25

Aktuální release workflow nepoužívá ruční nahrání zdrojů přímo do `main`.

## Candidate

1. Změny nahrajte do dlouhodobé větve `candidate`.
2. Ověřte, že `package.json`, platformní manifesty, service-worker cache a `studio/app-manifest.template.json` uvádějí verzi `1.2.25`.
3. Candidate musí projít P5 kontrolami, GARP 2.7 FOUNDATION a zachovanými GARP 2.5.1/N5 regresními kontrolami.
4. Nepovažujte stav `FOUNDATION_PASS_LIVE_NOT_TESTED` za school-server LIVE schválení. Serverově závislé kontroly zůstávají `NOT_TESTED`, dokud neexistuje schválený runtime.

## Promotion candidate → main

1. Použijte Safe Promotion / PR `candidate → main`; nepushujte release změny přímo do `main`.
2. Před merge musí být zelené required checks podle aktuální branch protection, zejména candidate-to-main / P5 release gate / accessibility gate.
3. Produkční Pages deploy se smí spustit až nad schváleným `main` a exact release identity musí odpovídat zdrojovému commitu a artefaktům.

## Po deployi

1. Ověřte publikovaný `studio-manifest.json` a `release-integrity.json` proti exact release identity.
2. Ověřte dostupnost hlavní aplikace a `/manual/`.
3. `app-updated` do AI Studia odesílejte až po úspěšném live-release ověření.
4. Pokud se později aktivuje školní server, proveďte samostatný GARP 2.7 LIVE audit; lokální FOUNDATION výsledek jej nenahrazuje.
