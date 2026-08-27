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
  { deploymentBasePath: manifest.deploymentBasePath || "", qaAppId: manifest.appId },
);
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

async function waitForAppReady(page, timeout = 12000) {
  await page.waitForSelector('#app', { state: 'attached', timeout });
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    const content = document.querySelector('#page-content');
    const bodyVisible = getComputedStyle(document.body).visibility !== 'hidden';
    const expectedRoute = location.hash.replace(/^#\/?/, '') || 'overview';
    return Boolean(
      app && content && bodyVisible &&
      !app.hasAttribute('aria-busy') &&
      app.dataset.renderedRoute === expectedRoute
    );
  }, null, { timeout });
}

async function settleAppAfterAction(page, timeout = 10000) {
  // Hash changes are synchronous, rendering is not. Wait for the render that belongs
  // to the current hash instead of trusting an idle flag left by an older render.
  await page.waitForTimeout(75);
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    if (!app) return true;
    const expectedRoute = location.hash.replace(/^#\/?/, '') || 'overview';
    return !app.hasAttribute('aria-busy') && app.dataset.renderedRoute === expectedRoute;
  }, null, { timeout });
}


async function clickForQa(page, selector, timeout = 7000) {
  await page.waitForFunction((sel) => {
    const element = document.querySelector(sel);
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }, selector, { timeout });

  const result = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!(element instanceof HTMLElement) || element.hidden) return { clicked: false };
    if (element instanceof HTMLButtonElement && element.disabled) return { clicked: false };
    // Lesson Hub intentionally re-renders parts of the page during async actions.
    // Dispatch from the current DOM node instead of letting Playwright retain a
    // handle that can become detached while the click is being actionability-checked.
    if (element instanceof HTMLButtonElement && element.type === "submit" && element.form) {
      const formId = element.form.id || "";
      const modalSubmit = Boolean(element.form.closest(".modal-backdrop"));
      element.form.requestSubmit(element);
      return { clicked: true, formId, modalSubmit };
    }
    element.click();
    return { clicked: true, formId: "", modalSubmit: false };
  }, selector);
  if (!result?.clicked) throw new Error(`QA click target není dostupný: ${selector}`);
  return result;
}

async function waitForSubmittedForm(page, formId, timeout = 15000) {
  if (!formId) return;
  const form = page.locator(`#${formId}`);
  const error = form.locator("[data-form-error]");
  // The successful submit may close the modal and immediately change the SPA route.
  // Keep no JSHandle from the old execution context: Playwright locators survive that
  // transition and remove the jsonValue/navigation race seen in CI.
  const state = await Promise.race([
    form.waitFor({ state: "detached", timeout }).then(() => ({ state: "closed", message: "" })),
    error.waitFor({ state: "visible", timeout }).then(async () => ({
      state: "error",
      message: String((await error.textContent()) || "").trim(),
    })),
  ]);
  if (state.state === "error") throw new Error(`Formulář ${formId}: ${state.message}`);
}

async function executeEvaluateStep(page, source) {
  const script = String(source || "").trim();
  if (!script) return undefined;
  return page.evaluate(async (trustedSource) => {
    // Critical-flow definitions are repository-owned test code. Function expressions
    // must be invoked; page.evaluate("() => {...}") otherwise only returns a function.
    const candidate = (0, eval)(`(${trustedSource})`);
    return typeof candidate === "function" ? await candidate() : candidate;
  }, script);
}

async function resolveStepValue(page, value) {
  if (value !== '__TODAY__') return value ?? '';
  return page.evaluate(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  });
}
try {
  for (const flow of plan.flows || []) {
    let status = "PASS";
    let evidence = [];
    let flowBrowser = null;
    let context = null;
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
        // Critical workflows must be isolated at the browser-process level. Reusing a
        // long-lived Chromium process allowed service-worker/cache/background state
        // from earlier flows to make later IndexedDB-heavy setup scenarios flaky in CI.
        // PWA/service-worker behavior has its own dedicated release gate, so critical
        // functional flows intentionally run against an uncached fresh document.
        flowBrowser = await launchBrowser();
        context = await flowBrowser.newContext({
          viewport: flow.viewport || { width: 1366, height: 768 },
          serviceWorkers: "block",
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
        await page.route("**/AI-Studio-GHRAB/config/support.json", (r) =>
          r.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ administratorEmail: "balaz@ghrabuvka.cz" }),
          }),
        );
        await page.route("**/AI-Studio-GHRAB/config/apps.generated.json", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
        );
        const url =
          baseUrl + (flow.url.startsWith("/") ? flow.url : `/${flow.url}`);
        await setLocalDocument(
          page,
          path.join(ROOT, manifest.serveRoot || "dist"),
          flow.url,
          baseUrl,
        );
        await waitForAppReady(page);
        for (const step of flow.steps || []) {
          if (step.action === "wait") await page.waitForTimeout(step.ms || 500);
          if (step.action === "click") {
            const clickResult = await clickForQa(page, step.selector, step.timeout || 7000);
            if (clickResult.modalSubmit) await waitForSubmittedForm(page, clickResult.formId, step.submitTimeout || 15000);
          }
          if (step.action === "clickIfVisible") {
            const target = page.locator(step.selector).first();
            if ((await target.count()) && (await target.isVisible()))
              await clickForQa(page, step.selector, step.timeout || 7000);
          }
          if (step.action === "fill") {
            const target = page.locator(step.selector).first();
            await target.waitFor({ state: "visible", timeout: step.timeout || 10000 });
            await target.fill(await resolveStepValue(page, step.value), { timeout: step.timeout || 10000 });
          }
          if (step.action === "select")
            await page.locator(step.selector).first().selectOption(step.value);
          if (step.action === "press") await page.keyboard.press(step.key);
          if (step.action === "evaluate") await executeEvaluateStep(page, step.script);
          if (["click", "clickIfVisible", "select", "press", "evaluate"].includes(step.action)) {
            await settleAppAfterAction(page, step.timeout || 10000);
          }
          if (step.action === "assertText") {
            const txt = await page.locator(step.selector || "body").innerText();
            if (!txt.toLowerCase().includes(String(step.text).toLowerCase()))
              throw new Error(`Chybí text ${step.text}`);
          }
          if (step.action === "assertVisible") {
            try {
              await page.locator(step.selector).first().waitFor({ state: "visible", timeout: step.timeout || 10000 });
            } catch {
              throw new Error(`Prvek není viditelný: ${step.selector}`);
            }
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
      }
    } catch (error) {
      status = "FAIL";
      if (context) {
        try {
          const pages = context.pages();
          const page = pages.at(-1);
          if (page) {
            const diagnostic = await page.evaluate(() => ({
              url: location.href,
              hash: location.hash,
              renderedRoute: document.querySelector("#app")?.dataset?.renderedRoute || "",
              pendingRoute: document.querySelector("#app")?.dataset?.pendingRoute || "",
              busy: document.querySelector("#app")?.getAttribute("aria-busy") || "",
              formError: document.querySelector("[data-form-error]:not([hidden])")?.textContent?.trim() || "",
              body: document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 500) || "",
            }));
            evidence.push(`diag=${JSON.stringify(diagnostic)}`);
          }
        } catch {}
      }
      findings.push(
        finding(
          "critical",
          flow.severity || "MAJOR",
          "CRITICAL_FLOW_FAIL",
          `${flow.id}: ${error.message}`,
          evidence.join("; "),
        ),
      );
    } finally {
      await closeWithLimit(context);
      await closeWithLimit(flowBrowser);
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
for (const item of findings) {
  console.log(`CRITICAL FINDING [${item.code}]: ${item.message || "Nález bez popisu"}`);
  if (item.evidence) console.log(`CRITICAL EVIDENCE: ${item.evidence}`);
}
if (result.status === "FAIL") process.exitCode = 1;
