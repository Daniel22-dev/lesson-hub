import { downloadManualPdf } from "./pdf-export.js";

const basename = "lesson-hub-v1.2.26";
const manualTitle = "Lesson Hub";
const ACCESS = "granted";
function installPdfAction() {
  if (document.documentElement.dataset.ghrabAccess !== ACCESS) return;
  if (document.querySelector("#ghrab-manual-download-pdf")) return;
  const root = document.querySelector("main");
  if (!root) return;
  const wrapper = document.createElement("div");
  wrapper.className = "ghrab-manual-pdf-action";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", "Export manuálu");
  Object.assign(wrapper.style, { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center",
    padding: "12px 16px", margin: "12px 0 20px", border: "1px solid rgba(96,211,255,.35)",
    borderRadius: "15px", background: "rgba(20,75,104,.12)" });
  const button = document.createElement("button");
  button.id = "ghrab-manual-download-pdf";
  button.type = "button";
  button.textContent = "↓ Stáhnout kompletní PDF";
  Object.assign(button.style, { padding: "11px 14px", minHeight: "44px", border: "1px solid #63d9f2", borderRadius: "12px",
    cursor: "pointer", background: "#063f54", color: "#fff", font: "inherit", fontWeight: "700" });
  const note = document.createElement("span");
  note.textContent = "Celý manuál včetně všech kroků interaktivní prohlídky. Žádný veřejný PDF soubor.";
  Object.assign(note.style, { fontSize: "13px", lineHeight: "1.5", color: "inherit", opacity: ".82", flex: "1 1 210px" });
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  Object.assign(status.style, { fontSize: "13px", flexBasis: "100%" });
  wrapper.append(button, note, status);
  root.insertBefore(wrapper, root.firstChild);
  button.addEventListener("click", async () => {
    if (document.documentElement.dataset.ghrabAccess !== ACCESS) return;
    button.disabled = true;
    button.textContent = "Připravuji PDF…";
    status.textContent = "";
    try {
      const extras = Array.isArray(window.GHRAB_MANUAL_EXPORT) ? window.GHRAB_MANUAL_EXPORT : [];
      const search = document.querySelector("#manual-search");
      const originalQuery = search?.value || "";
      if (search && originalQuery) {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      try {
        const result = await downloadManualPdf(document, {
          title: manualTitle + " – úplný návod",
          filename: "GHRAB-manual-" + basename + ".pdf",
          extras
        });
        status.textContent = "PDF připraveno (" + result.pages + " str.).";
      } finally {
        if (search && originalQuery) {
          search.value = originalQuery;
          search.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    } catch (error) {
      status.textContent = "PDF nelze vytvořit: " + String(error?.message || error);
    } finally {
      button.disabled = false;
      button.textContent = "↓ Stáhnout kompletní PDF";
    }
  });
}
const observer = new MutationObserver(() => {
  if (document.documentElement.dataset.ghrabAccess === ACCESS) {
    observer.disconnect();
    installPdfAction();
  } else if (document.documentElement.dataset.ghrabAccess === "denied") {
    observer.disconnect();
  }
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ghrab-access"] });
if (document.documentElement.dataset.ghrabAccess === ACCESS) { observer.disconnect(); installPdfAction(); }
