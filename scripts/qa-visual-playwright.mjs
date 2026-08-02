import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import {
  ROOT,
  QA_DIR,
  SCREEN_DIR,
  startStaticServer,
  setLocalDocument,
  readJson,
  loadManifest,
  finding,
  gateResult,
  saveGate,
  ensureOutput,
  exists,
} from "./qa-core.mjs";

await ensureOutput();
const manifest = await loadManifest();
const plan = await readJson(path.join(QA_DIR, "visual-plan.json"));
const findings = [];
const matrix = [];
const serveRoot = path.join(ROOT, manifest.serveRoot || "dist");
const { server, baseUrl } = await startStaticServer(serveRoot);
const guardJs = `export async function protectApp(appId){document.documentElement.dataset.ghrabAccess='granted';document.dispatchEvent(new CustomEvent('ghrab:app-access-granted',{detail:{permit:{appId,qa:true}}}));return true}`;

function blankStats(buffer) {
  const png = PNG.sync.read(buffer);
  let n = 0;
  let sum = 0;
  let square = 0;
  let nearWhite = 0;
  let nearBlack = 0;
  const step = Math.max(1, Math.floor((png.width * png.height) / 50000));
  for (let i = 0; i < png.width * png.height; i += step) {
    const j = i * 4;
    const alpha = png.data[j + 3] / 255;
    const y =
      ((png.data[j] + png.data[j + 1] + png.data[j + 2]) / 3) * alpha +
      255 * (1 - alpha);
    n += 1;
    sum += y;
    square += y * y;
    if (y > 250) nearWhite += 1;
    if (y < 5) nearBlack += 1;
  }
  const mean = sum / n;
  return {
    mean,
    sd: Math.sqrt(Math.max(0, square / n - mean * mean)),
    whiteRatio: nearWhite / n,
    blackRatio: nearBlack / n,
  };
}

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
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-webgl",
      "--disable-accelerated-2d-canvas",
      "--disable-accelerated-video-decode",
      "--disable-features=Vulkan,CanvasOopRasterization",
    ],
  });
}

async function descendantPids(pid) {
  let direct = [];
  try {
    const raw = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    direct = raw
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
  const nested = [];
  for (const child of direct) nested.push(...(await descendantPids(child)));
  return [...nested, ...direct];
}

async function killBrowserDescendants() {
  for (const pid of await descendantPids(process.pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function closeWithLimit(target, ms = 8000, forceChildren = false) {
  if (!target) return;
  const ownedPids = forceChildren ? await descendantPids(process.pid) : [];
  let closed = false;
  await Promise.race([
    target
      .close()
      .then(() => {
        closed = true;
      })
      .catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
  if (forceChildren && !closed) {
    for (const pid of ownedPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await killBrowserDescendants();
  }
}

async function waitForImages(page) {
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images]
        .filter((img) => String(img.getAttribute("src") || "").trim())
        .map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
                setTimeout(done, 1800);
              }),
        ),
    );
  });
}

async function inspectPage(page, scenario) {
  return page.evaluate(
    ({ expectedText, mustVisible }) => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const visibleText = (document.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const vw = innerWidth;
      const vh = innerHeight;
      const overlays = [...document.querySelectorAll("body *")]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            tag: el.tagName,
            cls: el.className?.toString().slice(0, 100) || "",
            area: Math.max(0, rect.width) * Math.max(0, rect.height),
            fixed: style.position === "fixed",
            pointerEvents: style.pointerEvents,
            visibility: style.visibility,
            display: style.display,
            opacity: Number(style.opacity || 1),
            text: (el.innerText || "").trim(),
            controls:
              el.querySelectorAll?.("button,a,input,select,textarea").length ||
              0,
          };
        })
        .filter(
          (item) =>
            item.fixed &&
            item.area > vw * vh * 0.8 &&
            item.pointerEvents !== "none" &&
            item.visibility !== "hidden" &&
            item.display !== "none" &&
            item.opacity > 0.05 &&
            item.text.length < 3 &&
            item.controls === 0,
        );
      const visible = (mustVisible || []).map((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, ok: false, reason: "missing" };
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const ok =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || 1) > 0.01 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < vh &&
          rect.left < vw;
        return { selector, ok, reason: ok ? "" : "hidden-or-outside" };
      });
      const broken = [...document.images]
        .filter((img) => {
          const src = String(img.getAttribute("src") || "").trim();
          return (
            src &&
            ((!img.complete && src) || (img.complete && img.naturalWidth === 0))
          );
        })
        .map((img) => img.getAttribute("src"));
      const interactiveOutside = [
        ...document.querySelectorAll(
          "button,a,input,select,textarea,[role=button]",
        ),
      ]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            (rect.left < 0 || rect.right > vw)
          );
        })
        .map((el) => ({
          tag: el.tagName,
          text: (el.innerText || el.getAttribute("aria-label") || "")
            .trim()
            .slice(0, 80),
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
        }));
      return {
        htmlHidden:
          html.visibility === "hidden" ||
          html.display === "none" ||
          Number(html.opacity || 1) === 0,
        bodyHidden:
          body.visibility === "hidden" ||
          body.display === "none" ||
          Number(body.opacity || 1) === 0,
        textLength: visibleText.length,
        expected:
          !expectedText ||
          visibleText.toLowerCase().includes(expectedText.toLowerCase()),
        overflow: document.documentElement.scrollWidth - vw,
        overflowClipped: [html.overflowX, body.overflowX].some(
          (value) => value === "hidden" || value === "clip",
        ),
        interactiveOutside,
        overlays,
        visible,
        broken,
      };
    },
    {
      expectedText: scenario.expectedText || "",
      mustVisible: scenario.mustVisible || [],
    },
  );
}

let browser;
let runsInBrowser = 0;
const maxRunsPerBrowser = Number(process.env.GHRAB_VISUAL_BROWSER_BATCH || 1);

function isTransientBrowserError(error) {
  const text = String(error);
  return /Target (?:page|context|browser).*closed|has been closed|browserContext\.newPage|browser.*disconnected|Browser closed|crash|Page\.captureScreenshot|Unable to capture screenshot|Protocol error.*captureScreenshot|screenshot.*failed|Target crashed|Renderer process crashed/i.test(
    text,
  );
}

async function resetBrowser(force = false) {
  await closeWithLimit(browser, 8000, force);
  browser = undefined;
  runsInBrowser = 0;
}

async function ensureBrowser() {
  if (
    !browser ||
    !browser.isConnected() ||
    runsInBrowser >= maxRunsPerBrowser
  ) {
    await resetBrowser(true);
    browser = await launchBrowser();
    runsInBrowser = 0;
  }
  return browser;
}

const visualAttempts = Math.max(
  2,
  Number(process.env.GHRAB_VISUAL_ATTEMPTS || 3),
);
const screenshotAttempts = Math.max(
  2,
  Number(process.env.GHRAB_VISUAL_SCREENSHOT_ATTEMPTS || 3),
);

async function captureScreenshotWithRetry(page, targetPath) {
  let lastError;
  for (let attempt = 1; attempt <= screenshotAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await page.bringToFront().catch(() => {});
        await page.waitForTimeout(250 * attempt);
      }
      return await page.screenshot({
        path: targetPath,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
        timeout: 20000,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientBrowserError(error) || attempt >= screenshotAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function runVisualCase(scenario, viewport) {
  const transientErrors = [];
  for (let attempt = 1; attempt <= visualAttempts; attempt += 1) {
    let context;
    try {
      const activeBrowser = await ensureBrowser();
      runsInBrowser += 1;
      context = await activeBrowser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const badResponses = [];

      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !/Failed to load resource: net::ERR_FAILED/.test(message.text())
        ) {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        const text = String(error);
        if (
          !/Failed to read the 'localStorage' property.*Access is denied/i.test(
            text,
          )
        ) {
          pageErrors.push(text);
        }
      });
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          new URL(response.url()).origin === new URL(baseUrl).origin
        ) {
          badResponses.push(`${response.status()} ${response.url()}`);
        }
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (["media", "font"].includes(request.resourceType())) {
          return route.fulfill({ status: 204, body: "" });
        }
        return route.continue();
      });
      await page.route("**/AI-Studio-GHRAB/access/app-guard.js", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: guardJs,
        }),
      );
      await page.route("**/AI-Studio-GHRAB/access/access-gate.css", (route) =>
        route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );

      if (scenario.id === "studio-home") {
        await page.addInitScript(
          ({ version }) => {
            try {
              sessionStorage.setItem(`ghrab.startup-intro.${version}`, "seen");
            } catch {}
          },
          { version: manifest.version },
        );
      }
      await setLocalDocument(page, serveRoot, scenario.url, baseUrl);
      for (const step of scenario.steps || []) {
        if (step.action === "wait") await page.waitForTimeout(step.ms || 500);
        if (step.action === "click") {
          await page.locator(step.selector).first().click({ timeout: 5000 });
        }
        if (step.action === "clickIfVisible") {
          const target = page.locator(step.selector).first();
          if ((await target.count()) && (await target.isVisible())) {
            await target.click({ timeout: step.timeout || 5000 });
          }
        }
        if (step.action === "fill") {
          await page
            .locator(step.selector)
            .first()
            .fill(step.value || "");
        }
        if (step.action === "select") {
          await page.locator(step.selector).first().selectOption(step.value);
        }
        if (step.action === "press") await page.keyboard.press(step.key);
        if (step.action === "evaluate") await page.evaluate(step.script);
      }
      await page.waitForTimeout(scenario.settleMs || 700);
      await waitForImages(page);
      const checks = await inspectPage(page, scenario);
      const filename =
        `${scenario.id}__${viewport.width}x${viewport.height}.png`.replace(
          /[^a-zA-Z0-9_.-]/g,
          "-",
        );
      const screenshot = `qa-screenshots/${filename}`;
      const buffer = await captureScreenshotWithRetry(
        page,
        path.join(SCREEN_DIR, filename),
      );
      const pixels = blankStats(buffer);
      const problems = [];
      if (checks.htmlHidden || checks.bodyHidden)
        problems.push("html/body je skryté");
      if (checks.textLength < (scenario.minVisibleText || 20)) {
        problems.push(`viditelný text je příliš krátký (${checks.textLength})`);
      }
      if (!checks.expected)
        problems.push(`chybí očekávaný text ${scenario.expectedText}`);
      if (
        checks.overflow > 2 &&
        (!checks.overflowClipped || checks.interactiveOutside.length)
      ) {
        problems.push(
          `horizontální přetékání ${checks.overflow}px${checks.interactiveOutside.length ? " s interaktivním prvkem mimo viewport" : ""}`,
        );
      }
      if (checks.overlays.length)
        problems.push("prázdná interaktivní fullscreen vrstva");
      if (checks.visible.some((item) => !item.ok)) {
        problems.push(
          `povinný prvek není viditelný: ${checks.visible
            .filter((item) => !item.ok)
            .map((item) => item.selector)
            .join(", ")}`,
        );
      }
      if (checks.broken.length)
        problems.push(`nenačtené obrázky (${checks.broken.length})`);
      if (
        pixels.sd < 2 ||
        pixels.whiteRatio > 0.995 ||
        pixels.blackRatio > 0.995
      ) {
        problems.push(
          `screenshot je pravděpodobně prázdný (sd=${pixels.sd.toFixed(2)})`,
        );
      }
      if (consoleErrors.length)
        problems.push(`console.error (${consoleErrors.length})`);
      if (pageErrors.length) problems.push(`pageerror (${pageErrors.length})`);
      if (badResponses.length)
        problems.push(`lokální HTTP chyba (${badResponses.length})`);

      if (problems.length && attempt < visualAttempts) {
        transientErrors.push(
          `Vizuální kontrola zopakována: ${problems.join("; ")}`,
        );
        await closeWithLimit(context, 2500);
        context = undefined;
        await resetBrowser(true);
        continue;
      }
      if (problems.length) {
        return {
          matrix: {
            scenario: scenario.id,
            viewport: `${viewport.width}x${viewport.height}`,
            status: "FAIL",
            message: problems.join("; "),
            screenshot,
          },
          finding: finding(
            "visual",
            "MAJOR",
            "VISUAL_SCENARIO_FAIL",
            `${scenario.id} ${viewport.width}x${viewport.height}: ${problems.join("; ")}`,
            JSON.stringify({
              checks,
              pixels,
              consoleErrors,
              pageErrors,
              badResponses,
            }).slice(0, 8000),
          ),
        };
      }

      return {
        matrix: {
          scenario: scenario.id,
          viewport: `${viewport.width}x${viewport.height}`,
          status: "PASS",
          message: transientErrors.length
            ? `Obnoveno po dočasném pádu Chromia (${transientErrors.length} pokus).`
            : "",
          screenshot,
        },
      };
    } catch (error) {
      const text = String(error);
      if (isTransientBrowserError(error) && attempt < visualAttempts) {
        transientErrors.push(text);
        await closeWithLimit(context, 2500);
        context = undefined;
        await resetBrowser(true);
        continue;
      }
      return {
        matrix: {
          scenario: scenario.id,
          viewport: `${viewport.width}x${viewport.height}`,
          status: "FAIL",
          message: text,
          screenshot: "",
        },
        finding: finding(
          "visual",
          isTransientBrowserError(error) ? "BLOCKER" : "MAJOR",
          isTransientBrowserError(error)
            ? "CHROMIUM_RUNTIME"
            : "VISUAL_RUNTIME",
          `${scenario.id} ${viewport.width}x${viewport.height}: ${text}`,
          transientErrors.length
            ? transientErrors.join("\n--- retry ---\n")
            : "",
        ),
      };
    } finally {
      await closeWithLimit(context, 2500);
    }
  }
}

try {
  for (const scenario of plan.scenarios) {
    const viewports = scenario.viewports?.length
      ? scenario.viewports
      : manifest.requiredViewports;
    for (const viewport of viewports) {
      const result = await runVisualCase(scenario, viewport);
      matrix.push(result.matrix);
      if (result.finding) findings.push(result.finding);
    }
  }
} catch (error) {
  findings.push(
    finding(
      "visual",
      "BLOCKER",
      "CHROMIUM_START",
      `Chromium pro vizuální kontrolu nelze spustit: ${error.message}`,
    ),
  );
} finally {
  await resetBrowser(true);
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

const result = gateResult("visual", findings, {
  scenarios: plan.scenarios.length,
  runs: matrix.length,
  matrix,
});
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "visual.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  `VISUAL ${result.status}: ${findings.length} nálezů, ${matrix.length} běhů`,
);
for (const item of findings) {
  console.log(`VISUAL FINDING [${item.code}]: ${item.summary}`);
}
process.exit(result.status === "FAIL" ? 1 : 0);
