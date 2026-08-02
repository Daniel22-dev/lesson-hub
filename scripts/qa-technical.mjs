import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ROOT,
  QA_DIR,
  exists,
  walk,
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
if (m.standard !== "GHRAB-QA-1.0.2")
  f.push(
    finding(
      "technical",
      "BLOCKER",
      "STANDARD_MISMATCH",
      `Manifest používá ${m.standard}, očekává se GHRAB-QA-1.0.2.`,
    ),
  );
const pkgPath = path.join(ROOT, "package.json");
if (!(await exists(pkgPath)))
  f.push(
    finding("technical", "BLOCKER", "PACKAGE_MISSING", "Chybí package.json."),
  );
let pkg = {};
if (await exists(pkgPath)) pkg = await readJson(pkgPath);
if (!(await exists(path.join(ROOT, "package-lock.json"))))
  f.push(
    finding(
      "technical",
      "MAJOR",
      "LOCKFILE_MISSING",
      "Chybí package-lock.json; npm ci není reprodukovatelné.",
    ),
  );
else {
  const lock = await readFile(path.join(ROOT, "package-lock.json"), "utf8");
  if (/openai|codex|applied-caas|artifactory/i.test(lock))
    f.push(
      finding(
        "technical",
        "MAJOR",
        "INTERNAL_REGISTRY",
        "Lockfile obsahuje interní registry OpenAI/Codex.",
      ),
    );
}
if (pkg.version !== m.appVersion)
  f.push(
    finding(
      "technical",
      "MAJOR",
      "PACKAGE_VERSION_MISMATCH",
      `package.json=${pkg.version}, QA manifest=${m.appVersion}.`,
    ),
  );
const gitignorePath = path.join(ROOT, ".gitignore");
if (!(await exists(gitignorePath))) {
  f.push(
    finding(
      "technical",
      "MAJOR",
      "GITIGNORE_MISSING",
      "Chybí .gitignore pro generované a lokální soubory.",
    ),
  );
} else {
  const ignored = (await readFile(gitignorePath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""));
  for (const required of [
    "node_modules",
    "qa-results",
    m.buildRoot || "dist",
  ]) {
    if (!ignored.includes(required)) {
      f.push(
        finding(
          "technical",
          "MAJOR",
          "GENERATED_PATH_NOT_IGNORED",
          `.gitignore nevylučuje generovanou cestu ${required}/.`,
        ),
      );
    }
  }
}
for (const check of m.versionChecks || []) {
  const p = path.join(ROOT, check.file);
  if (!(await exists(p))) {
    f.push(
      finding(
        "technical",
        "MAJOR",
        "VERSION_SOURCE_MISSING",
        `Chybí ${check.file}.`,
      ),
    );
    continue;
  }
  const text = await readFile(p, "utf8");
  const match = text.match(new RegExp(check.regex, check.flags || "m"));
  const got = match?.[check.group || 1];
  if (got !== check.expected)
    f.push(
      finding(
        "technical",
        "MAJOR",
        "VERSION_MISMATCH",
        `${check.file}: očekáváno ${check.expected}, nalezeno ${got || "nic"}.`,
        check.regex,
      ),
    );
}
const files = await walk(ROOT, {
  skip: ["node_modules", "dist", "qa-results", ".git"],
});
for (const p of files) {
  const rel = path.relative(ROOT, p).split(path.sep).join("/");
  if (/(?:\.bak|\.orig|\.tmp|~)$/i.test(rel))
    f.push(
      finding(
        "technical",
        "MINOR",
        "BACKUP_FILE",
        `Nechtěný záložní soubor: ${rel}.`,
      ),
    );
  if (rel !== '.env.example' && /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|p12|key))$/i.test(rel))
    f.push(
      finding(
        "technical",
        "MAJOR",
        "SENSITIVE_FILE",
        `Potenciálně citlivý soubor: ${rel}.`,
      ),
    );
}
for (const p of files.filter(
  (x) => /\.(?:js|mjs)$/.test(x) && !/\.example\./.test(x),
)) {
  const rel = path.relative(ROOT, p).split(path.sep).join("/");
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
  } catch (e) {
    f.push(
      finding(
        "technical",
        "BLOCKER",
        "JS_SYNTAX",
        `Syntaktická chyba v ${rel}.`,
        String(e.stderr || e.message).slice(0, 1000),
      ),
    );
  }
  const text = await readFile(p, "utf8");
  for (const match of text.matchAll(
    /(?:import\s+(?:[^"']+?\s+from\s+)?|import\()(["'])(\.\.?\/[^"']+)\1/g,
  )) {
    if (rel.startsWith("tests/") || rel.startsWith("test/")) continue;
    let target = path.resolve(path.dirname(p), match[2]);
    if (!path.extname(target)) target += ".js";
    let generatedTarget = "";
    const srcRoot = path.join(ROOT, "src") + path.sep;
    if (target.startsWith(srcRoot)) {
      generatedTarget = path.join(
        ROOT,
        "dist",
        path.relative(path.join(ROOT, "src"), target),
      );
    }
    if (
      !(await exists(target)) &&
      !(generatedTarget && (await exists(generatedTarget)))
    )
      f.push(
        finding(
          "technical",
          "MAJOR",
          "MISSING_IMPORT",
          `${rel} odkazuje na neexistující ${match[2]}.`,
        ),
      );
  }
  if (/(?:\/home\/[^/]+\/|[A-Za-z]:\\Users\\)/.test(text))
    f.push(
      finding(
        "technical",
        "MAJOR",
        "ABSOLUTE_PATH",
        `Interní absolutní cesta v ${rel}.`,
      ),
    );
}
const workflows = files.filter((p) =>
  p.includes(`${path.sep}.github${path.sep}workflows${path.sep}`),
);
if (!workflows.length)
  f.push(
    finding(
      "technical",
      "MAJOR",
      "WORKFLOW_MISSING",
      "Chybí GitHub Actions workflow.",
    ),
  );
else {
  const all = (
    await Promise.all(workflows.map((p) => readFile(p, "utf8")))
  ).join("\n");
  if (!/npm run qa:release/.test(all))
    f.push(
      finding(
        "technical",
        "MAJOR",
        "CI_NO_QA_RELEASE",
        "GitHub Actions nespouští npm run qa:release.",
      ),
    );
  if (!/playwright install/.test(all))
    f.push(
      finding(
        "technical",
        "MAJOR",
        "CI_NO_CHROMIUM",
        "GitHub Actions neinstaluje Playwright Chromium.",
      ),
    );
}
const runtimeRoots = m.compatibility?.runtimeSourceRoots || ["src", "public"];
if (m.compatibility?.disallowRegexLookbehind !== false) {
  for (const p of files.filter((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    return (
      runtimeRoots.some((root) => rel === root || rel.startsWith(root + "/")) &&
      /\.(?:js|mjs|html)$/.test(rel)
    );
  })) {
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    const text = await readFile(p, "utf8");
    if (/\(\?(?:<=|<!)/.test(text)) {
      f.push(
        finding(
          "technical",
          "MAJOR",
          "RUNTIME_REGEX_LOOKBEHIND",
          `Runtime soubor ${rel} používá regex lookbehind, který může způsobit parse-time pád v nepodporovaném prohlížeči.`,
        ),
      );
    }
  }
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'server', 'test-server.mjs')], { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
  execFileSync(process.execPath, [path.join(ROOT, 'server', 'test-client-integration.mjs')], { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
} catch (error) {
  f.push(finding('technical', 'BLOCKER', 'SERVER_TEST_FAILED', 'Vestavěný test serverového API neprošel.', String(error.stderr || error.message).slice(0, 1200)));
}

const result = gateResult("technical", f, {
  packageVersion: pkg.version,
  node: process.version,
  filesChecked: files.length,
});
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "technical.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(`TECHNICAL ${result.status}: ${f.length} nálezů`);
if (result.status === "FAIL") process.exitCode = 1;
