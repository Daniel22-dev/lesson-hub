import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  access,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STANDARD = "GHRAB-QA-1.0.2";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const QA_DIR = path.join(ROOT, "qa");
export const OUT_DIR = path.join(ROOT, "qa-results");
export const LOG_DIR = path.join(OUT_DIR, "qa-logs");
export const SCREEN_DIR = path.join(OUT_DIR, "qa-screenshots");
export const DIFF_DIR = path.join(OUT_DIR, "qa-differences");
export const STATE_FILE = path.join(OUT_DIR, ".qa-state.json");

export async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
export async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}
export async function loadManifest() {
  return readJson(path.join(QA_DIR, "qa-manifest.json"));
}
export async function ensureOutput() {
  for (const p of [OUT_DIR, LOG_DIR, SCREEN_DIR, DIFF_DIR])
    await mkdir(p, { recursive: true });
}
export function finding(gate, severity, code, message, evidence = "") {
  return { gate, severity, code, message, evidence };
}
export function gateResult(name, findings = [], details = {}) {
  const blockers = findings.filter((x) => x.severity === "BLOCKER").length;
  const majors = findings.filter((x) => x.severity === "MAJOR").length;
  const minors = findings.filter((x) => x.severity === "MINOR").length;
  return {
    name,
    status: blockers || majors ? "FAIL" : minors ? "WARN" : "PASS",
    findings,
    details,
  };
}
export async function loadState() {
  if (!(await exists(STATE_FILE))) return { gates: {}, commands: [] };
  return readJson(STATE_FILE);
}
export async function saveState(state) {
  await ensureOutput();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}
export async function saveGate(result) {
  const state = await loadState();
  state.gates[result.name] = result;
  await saveState(state);
  return result;
}
export async function walk(dir, { skip = [] } = {}) {
  if (!(await exists(dir))) return [];
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (skip.some((s) => rel === s || rel.startsWith(s + "/"))) continue;
    if (ent.isDirectory()) out.push(...(await walk(full, { skip })));
    else out.push(full);
  }
  return out;
}
export async function sha256File(p) {
  const b = await readFile(p);
  return createHash("sha256").update(b).digest("hex");
}
export async function sha256Tree(dir) {
  const h = createHash("sha256");
  const files = (await walk(dir)).sort();
  for (const f of files) {
    h.update(path.relative(dir, f).split(path.sep).join("/"));
    h.update("\0");
    h.update(await readFile(f));
    h.update("\0");
  }
  return h.digest("hex");
}
export async function runCommand(
  command,
  label,
  { cwd = ROOT, env = {} } = {},
) {
  await ensureOutput();
  const logPath = path.join(LOG_DIR, `${label}.log`);
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
    });
    let text = "";
    let settled = false;
    child.stdout.on("data", (d) => {
      text += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      text += d;
      process.stderr.write(d);
    });
    const finish = async (code) => {
      if (settled) return;
      settled = true;
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(logPath, text);
      resolve({
        command,
        label,
        code: code ?? 1,
        log: path.relative(ROOT, logPath).split(path.sep).join("/"),
      });
    };
    child.on("exit", finish);
    child.on("error", async (error) => {
      text += String(error);
      await finish(1);
    });
  });
}
export function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".pdf": "application/pdf",
    }[ext] || "application/octet-stream"
  );
}
export async function startStaticServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      if (!rel) rel = "index.html";
      let target = path.resolve(rootDir, rel);
      if (!target.startsWith(path.resolve(rootDir))) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      try {
        if ((await stat(target)).isDirectory())
          target = path.join(target, "index.html");
      } catch {}
      if (!(await exists(target))) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found");
      }
      res.writeHead(200, {
        "content-type": mimeFor(target),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      res.end(await readFile(target));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  return { server, baseUrl: `http://127.0.0.1:${a.port}` };
}

export async function setLocalDocument(page, rootDir, urlPath, baseUrl) {
  const clean =
    String(urlPath || "/index.html")
      .split("?")[0]
      .replace(/^\/+/, "") || "index.html";
  let target = path.join(rootDir, clean);
  if ((await stat(target)).isDirectory())
    target = path.join(target, "index.html");
  let html = await readFile(target, "utf8");
  html = html.replace(
    /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    "",
  );
  const basePath = path.posix.dirname("/" + clean).replace(/\/$/, "") + "/";
  const base = `<base href="${baseUrl}${basePath}">`;
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`)
    : base + html;
  await page.addInitScript(() => {
    const makeStorage = () => {
      const values = new Map();
      return {
        get length() {
          return values.size;
        },
        key(i) {
          return [...values.keys()][i] ?? null;
        },
        getItem(k) {
          return values.has(String(k)) ? values.get(String(k)) : null;
        },
        setItem(k, v) {
          values.set(String(k), String(v));
        },
        removeItem(k) {
          values.delete(String(k));
        },
        clear() {
          values.clear();
        },
      };
    };
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: makeStorage(),
      });
    } catch {}
    try {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        value: makeStorage(),
      });
    } catch {}
    if (!navigator.serviceWorker) {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => ({ update: async () => {} }),
          addEventListener() {},
          ready: Promise.resolve({}),
        },
      });
    }
  });
  await page.setContent(html, { waitUntil: "load", timeout: 20000 });
  return target;
}

export function csvCell(v) {
  const s = String(v ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}
