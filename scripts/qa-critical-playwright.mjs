import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  QA_DIR,
  readJson,
  loadManifest,
  startStaticServer,
  setLocalDocument,
  finding,
  gateResult,
  saveGate,
  ensureOutput,
  exists,
} from "./qa-core.mjs";

await ensureOutput();
const manifest = await loadManifest();
const plan = await readJson(path.join(QA_DIR, "critical-flows.json"));
const findings = [];
const matrix = [];
const { server, baseUrl } = await startStaticServer(
  path.join(ROOT, manifest.serveRoot || "dist"),
);
let browser;
const guardJs = `export async function protectApp(appId){document.documentElement.dataset.ghrabAccess='granted';document.dispatchEvent(new CustomEvent('ghrab:app-access-granted',{detail:{permit:{appId,qa:true}}}));return true}`;

async function launchBrowser() {
  let executablePath = process.env.GHRAB_CHROMIUM_PATH || "";
  if (!executablePath) {
    const bundled = chromium.executablePath();
    if (bundled && (await exists(bundled))) executablePath = bundled;
  }
  if (!executablePath) {
    for (const candidate of [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ]) {
      if (await exists(candidate)) {
        executablePath = candidate;
        break;
      }
    }
  }
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

async function closeWithLimit(target, ms = 4000) {
  if (!target) return;
  await Promise.race([
    target.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}
try {
  browser = await launchBrowser();
  for (const flow of plan.flows || []) {
    let status = "PASS";
    let evidence = [];
    try {
      if (flow.type === "static") {
        for (const assertion of flow.assertions || []) {
          const p = path.join(ROOT, assertion.file);
          if (!(await exists(p))) throw new Error(`Chybí ${assertion.file}`);
          const text = await readFile(p, "utf8");
          const ok = assertion.notRegex
            ? !new RegExp(assertion.notRegex, assertion.flags || "m").test(text)
            : new RegExp(assertion.regex, assertion.flags || "m").test(text);
          if (!ok)
            throw new Error(
              assertion.message || `Neprošla kontrola ${assertion.file}`,
            );
          evidence.push(`${assertion.file}: PASS`);
        }
      } else {
        const context = await browser.newContext({
          viewport: flow.viewport || { width: 1366, height: 768 },
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        await page.route("**/AI-Studio-GHRAB/access/app-guard.js", (r) =>
          r.fulfill({
            status: 200,
            contentType: "text/javascript",
            body: guardJs,
          }),
        );
        await page.route("**/AI-Studio-GHRAB/access/access-gate.css", (r) =>
          r.fulfill({ status: 200, contentType: "text/css", body: "" }),
        );
        const url =
          baseUrl + (flow.url.startsWith("/") ? flow.url : `/${flow.url}`);
        await setLocalDocument(
          page,
          path.join(ROOT, manifest.serveRoot || "dist"),
          flow.url,
          baseUrl,
        );
        for (const step of flow.steps || []) {
          if (step.action === "wait") await page.waitForTimeout(step.ms || 500);
          if (step.action === "click")
            await page
              .locator(step.selector)
              .first()
              .click({ timeout: step.timeout || 7000 });
          if (step.action === "clickIfVisible") {
            const target = page.locator(step.selector).first();
            if ((await target.count()) && (await target.isVisible()))
              await target.click({ timeout: step.timeout || 7000 });
          }
          if (step.action === "fill")
            await page
              .locator(step.selector)
              .first()
              .fill(step.value || "");
          if (step.action === "select")
            await page.locator(step.selector).first().selectOption(step.value);
          if (step.action === "press") await page.keyboard.press(step.key);
          if (step.action === "evaluate") await page.evaluate(step.script);
          if (step.action === "assertText") {
            const txt = await page.locator(step.selector || "body").innerText();
            if (!txt.toLowerCase().includes(String(step.text).toLowerCase()))
              throw new Error(`Chybí text ${step.text}`);
          }
          if (step.action === "assertVisible") {
            if (!(await page.locator(step.selector).first().isVisible()))
              throw new Error(`Prvek není viditelný: ${step.selector}`);
          }
        }
        const bodyText = (await page.locator("body").innerText()).trim();
        if (
          flow.expectedText &&
          !bodyText.toLowerCase().includes(flow.expectedText.toLowerCase())
        )
          throw new Error(`Chybí očekávaný text ${flow.expectedText}`);
        if (bodyText.length < (flow.minVisibleText || 20))
          throw new Error("Výsledek workflow nemá dost viditelného obsahu");
        if (errors.length)
          throw new Error(
            `Konzole workflow: ${errors.join(" | ").slice(0, 1000)}`,
          );
        evidence.push(url);
        await closeWithLimit(context);
      }
    } catch (error) {
      status = "FAIL";
      findings.push(
        finding(
          "critical",
          flow.severity || "MAJOR",
          "CRITICAL_FLOW_FAIL",
          `${flow.id}: ${error.message}`,
          evidence.join("; "),
        ),
      );
    }
    matrix.push({ id: flow.id, name: flow.name, status, evidence });
  }
} catch (error) {
  findings.push(
    finding(
      "critical",
      "BLOCKER",
      "CHROMIUM_START",
      `Chromium pro kritická workflow nelze spustit: ${error.message}`,
    ),
  );
} finally {
  await closeWithLimit(browser);
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}
const result = gateResult("critical", findings, { flows: matrix });
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "critical.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `CRITICAL ${result.status}: ${findings.length} nálezů, ${matrix.length} workflow`,
);
if (result.status === "FAIL") process.exitCode = 1;
