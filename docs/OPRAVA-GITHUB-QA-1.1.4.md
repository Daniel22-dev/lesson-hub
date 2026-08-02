# Oprava GitHub QA — Lesson Hub 1.1.4

Verze 1.1.4 opravuje tři příčiny selhání skutečného běhu GitHub Actions:

1. Vizuální brána již nepovažuje CSS viditelný prvek níže pod prvním svislým viewportem za skrytý. Vodorovné umístění a přetékání se kontrolují nadále.
2. Kritická workflow čekají na dokončení asynchronního vykreslení aplikace po otevření stránky i po akcích, které mohou změnit trasu nebo data.
3. Scénáře dnešní výuky používají dynamický token `__TODAY__` místo pevného data 30. 7. 2026.

Reportér z verze 1.1.3 zůstává zachován: skutečné nálezy vypisuje přes `message` a přidává `evidence`, takže se už nezobrazí neurčité `undefined`.
