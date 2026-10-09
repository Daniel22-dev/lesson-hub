// Context-aware manual navigation. Keep authorization in the app guard.
const embedded = window.parent !== window;
const fromStudio = new URLSearchParams(location.search).get("from") === "studio";
const studioUrl = "https://daniel22-dev.github.io/AI-Studio-GHRAB/";
const back = [...document.querySelectorAll("a")].find(a => /Zpět do aplikace/.test(a.textContent || ""));
if (embedded) {
  if (back) { back.hidden = true; back.style.display = "none"; }
  document.querySelectorAll('button[onclick*="window.print"],button[title*="Vytisknout"]').forEach(button => {
    button.hidden = true; button.style.display = "none";
  });
} else {
  if (back && fromStudio) {
    back.href = studioUrl + "manualy/";
    back.textContent = "← Zpět na manuály";
    back.title = "Vrátit se do centra manuálů";
  }
  const home = document.createElement("a");
  home.href = studioUrl;
  home.textContent = "AI Studio";
  home.setAttribute("aria-label", "Přejít do AI Studia");
  home.style.cssText = "display:inline-flex;align-items:center;margin:8px;padding:10px 14px;border:1px solid currentColor;border-radius:10px;color:inherit;text-decoration:none;font-weight:750";
  (back?.parentElement || document.querySelector("header") || document.querySelector("main"))?.append(home);
}
