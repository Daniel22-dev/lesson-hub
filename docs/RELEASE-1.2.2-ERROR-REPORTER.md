# Lesson Hub 1.2.2 – reportér a deployment P0

Reportér 1.1.0 se načítá asynchronně mimo kritickou cestu `main.js`. Aplikace a manuál používají společný deployment kontrakt; výpadek adaptéru pouze zapíše varování. Serverová relace a gateway zůstávají explicitně etapou P1.
