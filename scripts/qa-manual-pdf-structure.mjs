import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootManual = "public/manual/index.html";
const expectTour = false;
const isMaturitaDesk = false;
const fail = message => { throw new Error("[MANUAL PDF] " + message); };
const read = relative => readFileSync(path.join(root, relative), "utf8");

const html = read(rootManual);
const folder = path.posix.dirname(rootManual);
const sourcePath = path.posix.join(folder, "pdf-export.js");
const actionPath = path.posix.join(folder, "pdf-download.js");
const engine = read(sourcePath), action = read(actionPath);
for (const file of [sourcePath, actionPath])
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
if (!html.includes('data-ghrab-access="checking"') ||
    !html.includes('src="./pdf-download.js"')) fail("Missing role-gated HTML PDF integration");
if (!engine.includes('ghrabAccess !== "granted"') ||
    !engine.includes("ToUnicode") || !engine.includes('export async function downloadManualPdf'))
  fail("PDF engine must reject unauthenticated reads and emit searchable Unicode PDF");
if (!action.includes("MutationObserver") || !action.includes("downloadManualPdf") ||
    !action.includes('ghrabAccess !== ACCESS') || !action.includes("button.addEventListener"))
  fail("Download UI must be gated and interactive");
if (/https?:\/\/(?:cdn|unpkg|jsdelivr)\./i.test(engine + action))
  fail("Remote CDN dependency in private manual exporter");
if (expectTour) {
  const js = rootManual.includes("Hodnotitel") ? read("src/manual/manual.js") :
    rootManual.includes("src/manual/index") && read("package.json").includes("essay-evaluator") ? read("src/manual/manual.js") : html;
  if (!js.includes("GHRAB_MANUAL_EXPORT") || !js.includes("MANUAL.tour") || !js.includes("MANUAL.map"))
    fail("Interactive hidden tour or map missing from PDF export");
}
if (isMaturitaDesk) {
  const manifest = JSON.parse(read("src/studio-manifest.template.json"));
  const manualUrl = new URL(manifest.manualUrl);
  if (!manualUrl.pathname.endsWith("/src/manual/index.html")) fail("Studio manifest still links to the app shell");
  const bootstrap = read("src/manual/bootstrap.js");
  execFileSync(process.execPath, ["--check", path.join(root, "src/manual/bootstrap.js")], { stdio: "pipe" });
  if (!bootstrap.includes("protectApp") || !bootstrap.includes('APP_ID = "maturita-desk"') ||
    !bootstrap.includes("ghrabAccess !==")) fail("Maturita Desk manual missing fail-closed school permit");
  if (!html.includes("CONFIDENTIAL-EXAM") || !html.includes("pouze pro demonstraci"))
    fail("Controlled pilot / demo-only safety boundary is missing");
}
console.log("[MANUAL PDF] PASS: guarded source, Unicode PDF, no CDN, protected button, "+rootManual);
