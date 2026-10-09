/* Shared GHRAB manual navigation policy. No user data or arbitrary return URLs. */
(() => {
  "use strict";
  const root = document.documentElement;
  const appHome = new URL("../", location.href);
  const source = new URLSearchParams(location.search).get("ghrabFrom");
  function entryMode() {
    if (source === "studio" || source === "manuals") return "manuals";
    if (source === "app") return "app";
    try {
      const previous = new URL(document.referrer);
      if (previous.origin === location.origin &&
          previous.pathname.startsWith(appHome.pathname) &&
          !previous.pathname.includes("/manual/")) return "app";
    } catch { /* no trustworthy referrer */ }
    return "direct";
  }
  const mode = entryMode();
  function studioUrl() {
    const configured = window.__GHRAB_DEPLOYMENT_CONFIG__?.studioBaseUrl;
    const raw = configured || "/AI-Studio-GHRAB/";
    try {
      const u = new URL(raw, location.href);
      if (u.protocol === "https:" ||
          (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))
        return u.href;
    } catch { /* use fixed fallback */ }
    return new URL("/AI-Studio-GHRAB/", location.href).href;
  }
  function viewerFrame() {
    if (source !== "studio" || window.parent === window) return false;
    try {
      const host = window.parent.document.querySelector("#manual-frame");
      return Boolean(host && host.contentWindow === window);
    } catch { return false; }
  }
  function viewerPdfButton() {
    if (!viewerFrame()) return null;
    try { return window.parent.document.querySelector("#viewer-pdf"); }
    catch { return null; }
  }
  function makeLink(label, href) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    a.style.cssText = "display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:8px 12px;border:1px solid var(--line,#547089);border-radius:11px;background:var(--panel,#14283a);color:var(--text,#f0f7ff);font:700 13px/1.3 system-ui,sans-serif;text-decoration:none;white-space:nowrap;";
    a.addEventListener("focus", () => { a.style.outline = "3px solid #57cde5"; a.style.outlineOffset = "2px"; });
    a.addEventListener("blur", () => { a.style.outline = ""; a.style.outlineOffset = ""; });
    return a;
  }
  let watchedCentral = null;
  function cleanLegacy() {
    document.querySelectorAll("header a.manual-back, header a.back, header a[href='../']").forEach(a => {
      a.hidden = true;
      a.style.display = "none";
      a.setAttribute("aria-hidden", "true");
      a.tabIndex = -1;
    });
    document.querySelectorAll("header button[onclick]").forEach(b => {
      if ((b.getAttribute("onclick") || "").includes("window.print")) b.remove();
    });
  }
  function sync() {
    const current = document.querySelector("#ghrab-manual-toolbar");
    if (root.dataset.ghrabAccess !== "granted") {
      if (current) current.style.display = "none";
      return;
    }
    cleanLegacy();
    const bar = document.querySelector("header .top-actions") ||
      document.querySelector("header.top") ||
      document.querySelector("header .top") ||
      document.querySelector("header") ||
      document.querySelector("main");
    if (!bar) return;
    const embedded = viewerFrame();
    if (embedded) {
      const brand = document.querySelector("header.topbar .brand");
      if (brand) brand.style.display = "none";
    }
    let toolbar = current;
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "ghrab-manual-toolbar";
      toolbar.setAttribute("aria-label", "Ovládání manuálu");
      toolbar.style.cssText = "display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;max-width:100%;margin-left:auto;min-width:0;";
      const nav = document.createElement("nav");
      nav.id = "ghrab-manual-return";
      nav.setAttribute("aria-label", "Zpět z manuálu");
      nav.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;";
      if (mode === "app") nav.append(makeLink("← Zpět do aplikace", appHome.href));
      if (mode === "manuals") nav.append(makeLink("← Zpět na manuály", new URL("manualy/", studioUrl()).href));
      nav.append(makeLink("AI Studio", studioUrl()));
      toolbar.append(nav);
      bar.prepend(toolbar);
      if (bar !== document.querySelector("header .top-actions"))
        bar.style.flexWrap = "wrap";
    }
    toolbar.style.display = "flex";
    const nav = toolbar.querySelector("#ghrab-manual-return");
    if (nav) nav.style.display = embedded ? "none" : "flex";
    const localPdf = document.querySelector("#manual-pdf");
    if (localPdf) {
      if (localPdf.parentNode !== toolbar) toolbar.append(localPdf);
      if (localPdf.dataset.ghrabStyled !== "1") {
        localPdf.dataset.ghrabStyled = "1";
        localPdf.style.cssText = "display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin:0;padding:8px 14px;cursor:pointer;border:1px solid var(--line,#547089);border-radius:11px;background:var(--panel,#14283a);color:var(--text,#f0f7ff);font:800 13px/1.3 system-ui,sans-serif;white-space:nowrap;";
        localPdf.addEventListener("focus", () => { localPdf.style.outline = "3px solid #57cde5"; localPdf.style.outlineOffset = "2px"; });
        localPdf.addEventListener("blur", () => { localPdf.style.outline = ""; localPdf.style.outlineOffset = ""; });
      }
      const central = viewerPdfButton();
      const hideLocal = Boolean(central && !central.hidden);
      localPdf.hidden = hideLocal;
      localPdf.style.display = hideLocal ? "none" : "inline-flex";
      if (central && watchedCentral !== central) {
        watchedCentral = central;
        new MutationObserver(schedule).observe(central, { attributes: true, attributeFilter: ["hidden"] });
      }
    }
    const status = document.querySelector("#manual-pdf-status");
    if (status) {
      if (status.parentNode !== toolbar) toolbar.append(status);
      status.style.cssText = "max-width:250px;color:var(--muted,var(--text,#b7c8d4));font:500 12px/1.45 system-ui,sans-serif;";
    }
  }
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }
  const accessObserver = new MutationObserver(schedule);
  accessObserver.observe(root, { attributes: true, attributeFilter: ["data-ghrab-access"] });
  function startBodyObserver() {
    if (!document.body) return;
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }
  if (document.body) startBodyObserver();
  else document.addEventListener("DOMContentLoaded", startBodyObserver, { once: true });
})();
