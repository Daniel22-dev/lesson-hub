import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  exists,
  readJson,
  loadManifest,
  finding,
  gateResult,
  saveGate,
  ensureOutput,
} from "./qa-core.mjs";
await ensureOutput();
const m = await loadManifest();
const f = [];
let targets = 0;
for (const t of m.pwaTargets || []) {
  targets++;
  const root = path.join(ROOT, t.root || "dist");
  const mp = path.join(root, t.manifest);
  const sp = path.join(root, t.serviceWorker);
  if (!(await exists(mp))) {
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "MANIFEST_MISSING",
        `${t.id}: chybí ${path.relative(ROOT, mp)}.`,
      ),
    );
    continue;
  }
  let man;
  try {
    man = await readJson(mp);
  } catch (e) {
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "MANIFEST_INVALID",
        `${t.id}: neplatný PWA manifest.`,
        String(e),
      ),
    );
    continue;
  }
  if (!man.id || man.id !== '/lesson-hub/')
    f.push(finding('pwa', 'MAJOR', 'APP_ID_INVALID', `${t.id}: manifest musí mít stabilní id /lesson-hub/.`));
  if (/[?&]v=/.test(String(man.start_url || '')))
    f.push(finding('pwa', 'MAJOR', 'START_URL_VERSIONED', `${t.id}: start_url nesmí obsahovat verzi.`));
  if (!man.start_url)
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "START_URL_MISSING",
        `${t.id}: manifest nemá start_url.`,
      ),
    );
  if (!Array.isArray(man.icons) || !man.icons.length)
    f.push(
      finding("pwa", "MAJOR", "ICONS_MISSING", `${t.id}: manifest nemá ikony.`),
    );
  for (const icon of man.icons || []) {
    const ip = path.resolve(path.dirname(mp), icon.src);
    if (!(await exists(ip)))
      f.push(
        finding(
          "pwa",
          "MAJOR",
          "ICON_FILE_MISSING",
          `${t.id}: chybí ikona ${icon.src}.`,
        ),
      );
  }
  if (!(await exists(sp))) {
    f.push(
      finding("pwa", "MAJOR", "SW_MISSING", `${t.id}: chybí service worker.`),
    );
    continue;
  }
  const sw = await readFile(sp, "utf8");
  if (!/(?:addEventListener\(["']install|self\.oninstall)/.test(sw))
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "SW_INSTALL_MISSING",
        `${t.id}: service worker nemá install handler.`,
      ),
    );
  if (!/(?:addEventListener\(["']activate|self\.onactivate)/.test(sw))
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "SW_ACTIVATE_MISSING",
        `${t.id}: service worker nemá activate handler.`,
      ),
    );
  if (
    /caches\.keys\(\)[\s\S]{0,500}filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\s*!==/m.test(
      sw,
    ) &&
    !/startsWith\(/.test(sw)
  )
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "CROSS_APP_CACHE_DELETE",
        `${t.id}: aktivace může mazat cache jiných aplikací.`,
      ),
    );
  if (t.cachePrefix && !sw.includes(t.cachePrefix))
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "CACHE_PREFIX_MISMATCH",
        `${t.id}: service worker nepoužívá očekávaný prefix ${t.cachePrefix}.`,
      ),
    );
  if (
    /(?:\.add\([^)]*\)|\.addAll\([^)]*\))\.catch\(\s*(?:(?:\(\)|[A-Za-z_$][\w$]*)\s*=>\s*)?(?:null|undefined|false)\s*\)/s.test(
      sw,
    )
  )
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "PRECACHE_FAILURE_SWALLOWED",
        `${t.id}: service worker tiše ignoruje chybu povinného precache souboru.`,
      ),
    );
  if (
    /manual\/?(?:index\.html)?/.test(sw) &&
    /(?:c|cache)\.put\(\s*["']\.\/index\.html["']/.test(sw)
  )
    f.push(
      finding(
        "pwa",
        "MAJOR",
        "NAVIGATION_CACHE_COLLISION",
        `${t.id}: různé navigační stránky se ukládají pod jediný klíč ./index.html a mohou si přepsat offline obsah.`,
      ),
    );
  const declaredPrecache =
    sw.match(/\b(?:const|let|var)\s+(?:CORE_ASSETS|PRECACHE_ASSETS|APP_SHELL|CORE|REQUIRED)\s*=\s*(?:\/\*[^*]*\*\/\s*)?\[([\s\S]*?)\]\s*;/)?.[1] ||
    sw;
  const assets = [...declaredPrecache.matchAll(/["'`]((?:\.\/|\/)[^"'`?#]+)["'`]/g)]
    .map((x) => x[1])
    .filter((x) => !x.includes("AI-Studio-GHRAB/access"));
  for (const asset of new Set(assets)) {
    if (asset === "./" || asset === "/") continue;
    const clean = asset.replace(/^\.\//, "").replace(/^\//, "");
    const ap = path.join(root, clean);
    if (
      !(await exists(ap)) &&
      /\.(?:html|js|css|json|png|svg|webmanifest|ico|woff2)$/i.test(clean)
    )
      f.push(
        finding(
          "pwa",
          "MAJOR",
          "PRECACHE_FILE_MISSING",
          `${t.id}: service worker odkazuje na neexistující ${asset}.`,
        ),
      );
  }
}
const result = gateResult("pwa", f, { targets });
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "pwa.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(`PWA ${result.status}: ${f.length} nálezů`);
if (result.status === "FAIL") process.exitCode = 1;
