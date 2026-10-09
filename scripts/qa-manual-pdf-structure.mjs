import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(path.join(root, file), "utf8");
const html = read("public/manual/index.html");
const guide = read("public/manual/manual.js");
const jsPath = path.join(root, "src/manual/pdf-download.js");
const action = read("src/manual/pdf-download.js");
execFileSync(process.execPath, ["--check", jsPath], { stdio: "pipe" });
assert(html.includes('data-ghrab-access="checking"'), "Manual must start gated");
assert(html.includes('src="./pdf-download.js"'), "Missing local PDF button module");
assert(action.includes('ghrabAccess === "granted"'), "PDF control must require permit");
assert(action.includes('downloadManualPdf'), "Missing shared PDF exporter");
assert(action.includes("manualy/pdf-export.js"), "Incorrect PDF module location");
assert(action.includes("MutationObserver"), "Access transition not monitored");
assert(!["https://cdn.", "https://unpkg.", "https://jsdelivr."].some(host => action.includes(host)), "Unpinned CDN");
// Completeness checks: actual dynamic structures must be part of the exported content.
if ("dynamic" === "map") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT"), "Interactive tour not exported");
  assert(guide.includes("MANUAL.map") && guide.includes("MANUAL.tour"), "Guide map/tour incomplete");
} else if ("dynamic" === "tables") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT") && guide.includes("table"), "Tables missing from PDF");
} else if ("dynamic" === "dynamic") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT") && guide.includes("manual-warning"), "Dynamic safety messages missing");
}
function simulate(initial, change) {
  let button, status, observer;
  const rootNode = { dataset: { ghrabAccess: initial, ghrabAppId: "test-app" } };
  const main = { prepend(...nodes) { for (const n of nodes) {
    if (n.id === "manual-pdf") button = n;
    if (n.id === "manual-pdf-status") status = n;
  } } };
  const document = {
    documentElement: rootNode,
    querySelector(sel) {
      if (sel === "main") return main;
      if (sel === "#manual-pdf") return button;
      if (sel === "#manual-pdf-status") return status;
      return null;
    },
    createElement(tag) { return {
      tagName: tag.toUpperCase(), id: "",
      addEventListener(event, cb) { this.handlers ??= {}; this.handlers[event] = cb; },
      setAttribute(name, value) { this[name] = value; },
      remove() { if (this === button) button = undefined; if (this === status) status = undefined; }
    }; }
  };
  class MockObserver {
    constructor(cb) { this.cb = cb; observer = this; }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  runInNewContext(action, { document, window: {}, URL,
    MutationObserver: MockObserver, location: { href: "https://daniel22-dev.github.io/" } }, { filename: jsPath });
  const before = !!button;
  rootNode.dataset.ghrabAccess = change;
  if (observer?.active) observer.cb();
  return { before, after: !!button, label: button?.textContent, handlers: button?.handlers };
}
assert.equal(simulate("checking", "denied").after, false, "Denied users see PDF control");
assert.equal(simulate("checking", "granted").before, false, "PDF before grant");
const granted = simulate("checking", "granted");
assert.equal(granted.after, true, "PDF unavailable after grant");
assert(granted.handlers?.click, "PDF has no functional click handler");
assert.equal(simulate("granted", "denied").after, false, "PDF control survives revocation");
assert.match(granted.label, /Náhled PDF/, "Unreviewed manuals should be labelled preview");
console.log("[MANUAL PDF] PASS: access deny/grant/revoke, complete source, module syntax");
