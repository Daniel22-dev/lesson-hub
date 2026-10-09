/**
 * One PDF action per user context. The Studio viewer owns PDF when embedded.
 * A local PDF is offered only after explicit, version-matching content review.
 */
const root = document.documentElement;
function insideStudioViewer() {
  try {
    return window.parent !== window && window.frameElement?.id === "manual-frame" &&
      /\/manualy\/viewer\.html$/.test(window.parent.location.pathname);
  } catch { return false; }
}
function canDownloadManual() {
  if (insideStudioViewer() || root.dataset.ghrabAccess !== "granted") return false;
  const info = window.GHRAB_MANUAL_DOC_INFO;
  if (!info || info.reviewStatus !== "verified" ||
      info.appId !== root.dataset.ghrabAppId ||
      info.appVersion !== root.dataset.ghrabAppVersion) return false;
  if (!["map-tour-v1", "static-complete-sections-v1"].includes(info.pdfContentContract)) return false;
  if (info.pdfContentContract === "map-tour-v1" &&
      (!Array.isArray(window.GHRAB_MANUAL_EXPORT) || !window.GHRAB_MANUAL_EXPORT.length))
    return false;
  return true;
}
function refreshManualPdf() {
  const existing = document.getElementById("ghrab-manual-pdf");
  const status = document.getElementById("ghrab-manual-pdf-status");
  if (!canDownloadManual()) {
    existing?.remove();
    status?.remove();
    return;
  }
  if (existing) return;
  // Place it next to return navigation, never in the article body.
  const actions = document.getElementById("ghrab-manual-navigation");
  if (!actions) return;
  const button = document.createElement("button");
  button.type = "button";
  button.id = "ghrab-manual-pdf";
  button.className = "ghrab-manual-pdf";
  button.textContent = "↓ Stáhnout PDF";
  button.setAttribute("aria-label", "Stáhnout úplný manuál ve formátu PDF");
  const message = document.createElement("span");
  message.id = "ghrab-manual-pdf-status";
  message.setAttribute("role", "status");
  message.className = "ghrab-manual-pdf-status";
  actions.append(button, message);
  button.addEventListener("click", async () => {
    if (!canDownloadManual()) { message.textContent = "Přístup nebo revize manuálu není potvrzena."; return; }
    button.disabled = true;
    button.textContent = "Připravuji PDF…";
    message.textContent = "";
    try {
      const studioBase = new URL(
        window.__GHRAB_DEPLOYMENT_CONFIG__?.studioBaseUrl || "/AI-Studio-GHRAB/", location.href);
      const moduleUrl = new URL("manualy/pdf-export.js", studioBase);
      if (moduleUrl.origin !== location.origin || !["https:", "http:"].includes(moduleUrl.protocol))
        throw new Error("PDF modul není dostupný na důvěryhodném původu.");
      const { downloadManualPdf } = await import(moduleUrl.href);
      if (!canDownloadManual()) throw new Error("Přístup nebo revize se během exportu změnila.");
      await downloadManualPdf(document, {
        title: document.title,
        filename: "GHRAB-" + root.dataset.ghrabAppId + "-manual.pdf",
        extras: Array.isArray(window.GHRAB_MANUAL_EXPORT) ? window.GHRAB_MANUAL_EXPORT : []
      });
      message.textContent = "PDF staženo.";
    } catch (error) {
      message.textContent = "PDF se nepodařilo vytvořit: " + String(error?.message || error);
    } finally {
      button.disabled = false;
      button.textContent = "↓ Stáhnout PDF";
    }
  });
}
const watchPdf = new MutationObserver(refreshManualPdf);
watchPdf.observe(root, { attributes: true, attributeFilter: ["data-ghrab-access"],
  childList: true, subtree: true });
refreshManualPdf();
