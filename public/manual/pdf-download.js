const allowed = () => document.documentElement.dataset.ghrabAccess === "granted";
function refreshPdfControl() {
  const old = document.querySelector("#manual-pdf");
  const status = document.querySelector("#manual-pdf-status");
  if (!allowed()) {
    old?.remove();
    status?.remove();
    return;
  }
  if (old) return;
  const main = document.querySelector("main");
  if (!main) return;
  const button = document.createElement("button");
  const message = document.createElement("span");
  button.id = "manual-pdf";
  button.type = "button";
  const reviewed = window.GHRAB_MANUAL_DOC_INFO?.reviewStatus === "verified";
  button.textContent = "↓ Stáhnout PDF";
  button.style.cssText = "padding:12px;margin:12px;border-radius:10px;min-height:44px;cursor:pointer;background:var(--panel);color:var(--text);border:1px solid var(--line);";
  message.id = "manual-pdf-status";
  message.setAttribute("role", "status");
  main.prepend(button, message);
  button.addEventListener("click", async () => {
    if (!allowed()) { message.textContent = "Přístup k manuálu není potvrzen."; return; }
    button.disabled = true;
    message.textContent = "Připravuji PDF…";
    try {
      const studioBase = document.querySelector("[data-ghrab-studio-link]")?.href ||
        window.__GHRAB_DEPLOYMENT_CONFIG__?.studioBaseUrl ||
        new URL("/AI-Studio-GHRAB/", location.href).href;
      const exporterUrl = new URL("manualy/pdf-export.js", studioBase);
      if (exporterUrl.protocol !== "https:" && !(exporterUrl.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(exporterUrl.hostname)))
        throw new Error("Nepovolené umístění PDF modulu.");
      const { downloadManualPdf } = await import(exporterUrl.href);
      if (!allowed()) throw new Error("Oprávnění zaniklo během přípravy PDF.");
      const extras = Array.isArray(window.GHRAB_MANUAL_EXPORT) ? window.GHRAB_MANUAL_EXPORT : [];
      await downloadManualPdf(document, {
        title: document.title,
        filename: "GHRAB-" + document.documentElement.dataset.ghrabAppId + "-manual.pdf",
        extras
      });
      message.textContent = reviewed ? "PDF připraveno." : "PDF připraveno; věcná revize návodu ještě není potvrzena.";
    } catch (error) {
      message.textContent = "PDF se nepodařilo vytvořit: " + String(error?.message || error);
    } finally { button.disabled = false; }
  });
}
const accessObserver = new MutationObserver(refreshPdfControl);
accessObserver.observe(document.documentElement, {
  attributes: true, attributeFilter: ["data-ghrab-access"]
});
refreshPdfControl();
