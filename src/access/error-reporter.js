const REPORTER_ID = "ghrab-error-reporter";
const REPORTER_VERSION = "1.1.0";
const MAX_COMPOSE_URL_LENGTH = 7000;
const LOCAL_REPORTER_STYLE_URL = new URL("./error-reporter.css", import.meta.url);
const MAX_SCREENSHOTS = 5;
const MAX_CAPTURE_WIDTH = 1800;
const MAX_CAPTURE_HEIGHT = 1200;
const JPEG_QUALITY = 0.9;
const DEFAULT_SUPPORT_EMAIL = "balaz@ghrabuvka.cz";

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
async function loadSupportEmail(studioUrl, fallbackEmail = DEFAULT_SUPPORT_EMAIL) {
  try {
    const response = await fetch(new URL("config/support.json", studioUrl), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("support-config-unavailable");
    const config = await response.json();
    const email = String(config?.administratorEmail || "").trim();
    if (!validEmail(email)) throw new Error("support-email-invalid");
    return email;
  } catch (error) {
    const fallback = String(fallbackEmail || "").trim();
    if (validEmail(fallback)) return fallback;
    throw error;
  }
}

function language() {
  return document.documentElement.lang === "en" ? "en" : "cs";
}
function t(cs, en) {
  return language() === "cs" ? cs : en;
}
function safeName(value) {
  return (
    String(value || "aplikace")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "aplikace"
  );
}
function nowFileStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
}
function reportId() {
  return `GHRAB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function twoFrames() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}
function bytes(text) {
  return new TextEncoder().encode(text);
}
function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}
function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      ((date.getHours() & 31) << 11) |
      ((date.getMinutes() & 63) << 5) |
      (Math.floor(date.getSeconds() / 2) & 31),
    date:
      (((year - 1980) & 127) << 9) |
      (((date.getMonth() + 1) & 15) << 5) |
      (date.getDate() & 31),
  };
}
async function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const nameBytes = bytes(entry.name);
    const data =
      entry.data instanceof Uint8Array
        ? entry.data
        : new Uint8Array(await entry.data.arrayBuffer());
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    writeU32(lv, 0, 0x04034b50);
    writeU16(lv, 4, 20);
    writeU16(lv, 6, 0x0800);
    writeU16(lv, 8, 0);
    writeU16(lv, 10, stamp.time);
    writeU16(lv, 12, stamp.date);
    writeU32(lv, 14, crc);
    writeU32(lv, 18, data.length);
    writeU32(lv, 22, data.length);
    writeU16(lv, 26, nameBytes.length);
    writeU16(lv, 28, 0);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    writeU32(dv, 0, 0x02014b50);
    writeU16(dv, 4, 20);
    writeU16(dv, 6, 20);
    writeU16(dv, 8, 0x0800);
    writeU16(dv, 10, 0);
    writeU16(dv, 12, stamp.time);
    writeU16(dv, 14, stamp.date);
    writeU32(dv, 16, crc);
    writeU32(dv, 20, data.length);
    writeU32(dv, 24, data.length);
    writeU16(dv, 28, nameBytes.length);
    writeU16(dv, 30, 0);
    writeU16(dv, 32, 0);
    writeU16(dv, 34, 0);
    writeU16(dv, 36, 0);
    writeU32(dv, 38, 0);
    writeU32(dv, 42, offset);
    dir.set(nameBytes, 46);
    central.push(dir);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  writeU32(ev, 0, 0x06054b50);
  writeU16(ev, 4, 0);
  writeU16(ev, 6, 0);
  writeU16(ev, 8, entries.length);
  writeU16(ev, 10, entries.length);
  writeU32(ev, 12, centralSize);
  writeU32(ev, 16, offset);
  writeU16(ev, 20, 0);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load-failed"));
    };
    img.src = url;
  });
}
async function normaliseImage(blob) {
  const img = await loadImage(blob);
  const scale = Math.min(
    1,
    MAX_CAPTURE_WIDTH / img.naturalWidth,
    MAX_CAPTURE_HEIGHT / img.naturalHeight,
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("image-export-failed")),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

async function loadAppMeta(appId, studioUrl) {
  const fallbackNames = {
    generator: ["Generátor testů", "Test Generator"],
    ludus: ["LUDUS", "LUDUS"],
    differentiator: ["Diferenciátor", "Differentiator"],
    correspondence: ["Korespondenční asistent", "Correspondence Assistant"],
    "essay-evaluator": ["Hodnotitel slohů", "Essay Evaluator"],
    "activity-builder": ["ACTIVA", "ACTIVA"],
    sortio: ["SORTIO", "SORTIO"],
    "lesson-hub": ["Lesson Hub", "Lesson Hub"],
  };
  const fallback = fallbackNames[appId] || [appId, appId];
  try {
    const response = await fetch(
      new URL("config/apps.generated.json", studioUrl),
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(String(response.status));
    const list = await response.json();
    const app = Array.isArray(list)
      ? list.find((item) => item.id === appId)
      : null;
    return {
      appId,
      name:
        app?.name?.[language()] ||
        app?.name?.cs ||
        fallback[language() === "cs" ? 0 : 1],
      version: app?.version || "—",
    };
  } catch {
    return { appId, name: fallback[language() === "cs" ? 0 : 1], version: "—" };
  }
}

function injectStyles(styleUrl = LOCAL_REPORTER_STYLE_URL) {
  const id = "ghrab-error-reporter-css";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = new URL(styleUrl, location.href).href;
  document.head.append(link);
}

function normaliseTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  if (["light", "svetly", "světlý"].includes(theme)) return "light";
  if (["dark", "tmavy", "tmavý"].includes(theme)) return "dark";
  return "";
}

function reporterTheme(options = {}) {
  try {
    if (typeof options.themeResolver === "function") {
      const resolved = normaliseTheme(
        options.themeResolver({
          document,
          window,
          html: document.documentElement,
          body: document.body,
        }),
      );
      if (resolved) return resolved;
    }
  } catch {}
  const fixed = normaliseTheme(options.theme);
  if (fixed) return fixed;
  const html = document.documentElement;
  const body = document.body;
  for (const candidate of [
    html?.dataset?.theme,
    html?.dataset?.colorScheme,
    body?.dataset?.theme,
    body?.dataset?.colorScheme,
  ]) {
    const resolved = normaliseTheme(candidate);
    if (resolved) return resolved;
  }
  if (html?.classList.contains("light") || body?.classList.contains("light"))
    return "light";
  if (html?.classList.contains("dark") || body?.classList.contains("dark"))
    return "dark";
  const declared = normaliseTheme(
    getComputedStyle(html).colorScheme || getComputedStyle(body).colorScheme,
  );
  if (declared) return declared;
  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches
    ? "light"
    : "dark";
}

function installThemeSync(root, options = {}) {
  const apply = () => {
    const theme = reporterTheme(options);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };
  apply();
  const observer = new MutationObserver(apply);
  for (const node of [document.documentElement, document.body]) {
    if (node)
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
      });
  }
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  media?.addEventListener?.("change", apply);
  document.addEventListener("ghrab:theme-changed", apply);
  document.addEventListener("themechange", apply);
  return apply;
}

function sanitizeTechnicalText(value, max = 420) {
  let text = clipText(value, max * 2);
  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail odstraněn]")
    .replace(/(?:bearer\s+)[A-Z0-9._~+\/-]+/gi, "Bearer [token odstraněn]")
    .replace(/((?:api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token|password|heslo)\s*[:=]\s*)[^,;\s]+/gi, "$1[odstraněno]")
    .replace(/((?:prompt|puvodni text|původní text|original text|working text|pracovni text|pracovní text|model response|odpoved modelu|odpověď modelu|document content|obsah dokumentu|student data|data zaka|data žáka)\s*[:=]\s*)(?:["'`][^"'`\n]*["'`]|[^,;\n]+)/gi, "$1[obsah odstraněn]")
    .replace(/(["'`])[^\n]{120,}\1/g, "[dlouhý obsah odstraněn]");
  return clipText(text, max);
}

function button(label, className = "secondary") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `ghrab-report-button ${className}`;
  node.textContent = label;
  return node;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function browserLabel() {
  const brands = navigator.userAgentData?.brands
    ?.map((item) => `${item.brand} ${item.version}`)
    .join(", ");
  return brands || navigator.userAgent || "unknown";
}
function safeUrlPath(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail-odstranen]")
    .replace(/(?:%40|@)/gi, "[at]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[dlouhy-identifikator-odstranen]");
}
function safePageUrl() {
  return `${location.origin}${safeUrlPath(location.pathname)}`;
}
function clipText(value, max = 2200) {
  const text = String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, Math.max(0, max - 1)).join("")}…`
    : text;
}
function composeMailUrls(to, subject, body) {
  const encodedTo = encodeURIComponent(to);
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  return {
    mailtoUrl: `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`,
    gmailUrl: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`,
  };
}

export function fitMailBodyToComposeUrl({
  to,
  subject,
  description,
  stepsText,
  diagnostics = [],
  environmentLines = [],
  closingLines = [],
  maxUrlLength = MAX_COMPOSE_URL_LENGTH,
}) {
  const makeBody = (currentDescription, currentSteps, currentDiagnostics) => [
    "Dobrý den,",
    "",
    ...environmentLines,
    "",
    "CO SE STALO:",
    currentDescription || "Neuvedeno.",
    "",
    "JAK LZE CHYBU ZOPAKOVAT:",
    currentSteps || "Neuvedeno.",
    "",
    "AUTOMATICKY ZACHYCENÉ TECHNICKÉ ÚDAJE:",
    ...(currentDiagnostics.length ? currentDiagnostics : ["Podrobné technické údaje jsou v ZIP balíčku."]),
    "",
    ...closingLines,
  ].join("\n");

  const fullBody = makeBody(description, stepsText, diagnostics);
  let currentDescription = String(description || "");
  let currentSteps = String(stepsText || "");
  let currentDiagnostics = diagnostics.map((line) => clipText(line, 360));
  const fits = (body) => {
    const urls = composeMailUrls(to, subject, body);
    return Math.max(urls.gmailUrl.length, urls.mailtoUrl.length) <= maxUrlLength;
  };
  let body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  if (!fits(body)) {
    currentDiagnostics = currentDiagnostics.slice(0, 3).map((line) => clipText(line, 220));
    body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  }
  if (!fits(body)) {
    currentDiagnostics = [];
    body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  }
  if (!fits(body)) {
    currentSteps = clipText(currentSteps, 700);
    body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  }
  if (!fits(body)) {
    currentSteps = clipText(currentSteps, 320);
    body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  }
  if (!fits(body)) {
    let low = 120;
    let high = Math.max(low, currentDescription.length);
    let best = clipText(currentDescription, low);
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = clipText(currentDescription, mid);
      const candidateBody = makeBody(candidate, currentSteps, currentDiagnostics);
      if (fits(candidateBody)) {
        best = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    currentDescription = best;
    body = makeBody(currentDescription, currentSteps, currentDiagnostics);
  }
  if (!fits(body)) {
    body = clipText(body, 900);
  }
  const urls = composeMailUrls(to, subject, body);
  return { body, fullBody, ...urls };
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>\"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '\"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
function safeTechnicalUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return `${url.origin}${safeUrlPath(url.pathname)}`;
  } catch {
    return clipText(value, 280);
  }
}
function safeStack(value) {
  return clipText(value, 1800).replace(/https?:\/\/[^\s)]+/g, (match) =>
    safeTechnicalUrl(match),
  );
}
function technicalMessage(value) {
  if (value instanceof Error) return value.message || value.name || "Error";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "Neznámá chyba");
  }
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("data-url-failed"));
    reader.readAsDataURL(blob);
  });
}
async function fetchDataUrl(url) {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return "";
    return await blobToDataUrl(await response.blob());
  } catch {
    return "";
  }
}
async function pngBlobFromImage(blob) {
  const image = await loadImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("png-export-failed")),
      "image/png",
    ),
  );
}
function formatTechnicalErrors(errors = []) {
  if (!errors.length)
    return ["Automaticky nebyla zachycena žádná technická chyba."];
  return errors
    .slice(-6)
    .reverse()
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${item.type || "error"} · ${item.message || "bez zprávy"}`,
      ];
      if (item.status) parts.push(`HTTP ${item.status}`);
      if (item.phase) parts.push(`fáze ${item.phase}`);
      if (item.source) parts.push(item.source);
      if (item.durationMs != null) parts.push(`${item.durationMs} ms`);
      return parts.join(" · ");
    });
}
async function buildOverviewHtml({
  metadata,
  description,
  stepsText,
  screenshots,
  studioUrl,
}) {
  const [schoolLogo, portalImage] = await Promise.all([
    fetchDataUrl(new URL("assets/brand/school-logo.png", studioUrl)),
    fetchDataUrl(new URL("assets/brand/portal-gateway.webp", studioUrl)),
  ]);
  const shots = [];
  for (const item of screenshots) shots.push(await blobToDataUrl(item.blob));
  const technicalRows = formatTechnicalErrors(metadata.technicalErrors)
    .map((row) => `<li>${escapeHtml(row)}</li>`)
    .join("");
  const screenshotHtml = shots.length
    ? shots
        .map(
          (src, index) =>
            `<figure><img src="${src}" alt="Snímek ${index + 1}"><figcaption>Snímek ${index + 1}</figcaption></figure>`,
        )
        .join("")
    : '<p class="empty">Nebyly přiloženy žádné snímky.</p>';
  const reportCss = `
    :root { font-family: Inter, Arial, sans-serif; color: #10233f; background: #eef4fa; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; }
    .page { max-width: 980px; margin: auto; background: #fff; border: 1px solid #cbd9e8; border-radius: 24px; box-shadow: 0 22px 65px rgba(24, 57, 93, .15); overflow: hidden; }
    .head { display: grid; grid-template-columns: 92px 1fr 120px; gap: 22px; align-items: center; padding: 26px 30px; background: linear-gradient(135deg, #f9fcff, #eaf4ff); }
    .head img { max-width: 100%; max-height: 92px; object-fit: contain; }
    .head h1 { font-size: 28px; margin: 0 0 5px; color: #0b3974; }
    .head p { margin: 3px 0; color: #506880; }
    .badge { display: inline-block; margin-top: 8px; padding: 6px 10px; border-radius: 999px; background: #0b5fc5; color: #fff; font-weight: 800; font-size: 12px; }
    .body { padding: 28px 30px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .card { border: 1px solid #d4e0ed; border-radius: 17px; padding: 18px; background: #fbfdff; }
    .card.full { grid-column: 1 / -1; }
    .card h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; color: #0b5fc5; margin: 0 0 12px; }
    .card p, .card li { line-height: 1.5; }
    .meta { display: grid; grid-template-columns: 150px 1fr; gap: 7px 12px; font-size: 14px; }
    .meta b { color: #173a63; }
    .shots { display: grid; gap: 18px; }
    .shots figure { margin: 0; border: 1px solid #d4e0ed; border-radius: 14px; overflow: hidden; background: #f4f8fc; }
    .shots img { display: block; width: 100%; height: auto; }
    .shots figcaption { padding: 8px 12px; color: #52697f; font-size: 13px; }
    .foot { padding: 18px 30px; border-top: 1px solid #d4e0ed; display: flex; justify-content: space-between; color: #65798e; font-size: 13px; }
    @media (max-width: 720px) {
      body { padding: 0; }
      .page { border-radius: 0; }
      .head { grid-template-columns: 72px 1fr; }
      .head > img:last-child { display: none; }
      .grid { grid-template-columns: 1fr; }
      .card.full { grid-column: auto; }
    }
    @media print {
      body { padding: 0; background: #fff; }
      .page { box-shadow: none; border: 0; border-radius: 0; }
    }
  `;
  const logoHtml = schoolLogo
    ? `<img src="${schoolLogo}" alt="Logo školy">`
    : "<div></div>";
  const portalHtml = portalImage
    ? `<img src="${portalImage}" alt="AI Studio GHRAB">`
    : "<div></div>";
  const descriptionHtml = escapeHtml(description).replace(/\n/g, "<br>");
  const stepsHtml = escapeHtml(stepsText || "Neuvedeno.").replace(
    /\n/g,
    "<br>",
  );
  const createdAt = escapeHtml(
    new Date(metadata.createdAt).toLocaleString("cs-CZ"),
  );
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(metadata.reportId)} · hlášení chyby</title>
  <style>${reportCss}</style>
</head>
<body>
  <main class="page">
    <header class="head">
      ${logoHtml}
      <div>
        <h1>Hlášení technické chyby</h1>
        <p><strong>${escapeHtml(metadata.appName)}</strong> · verze ${escapeHtml(metadata.appVersion)}</p>
        <p>${createdAt}</p>
        <span class="badge">${escapeHtml(metadata.reportId)}</span>
      </div>
      ${portalHtml}
    </header>
    <section class="body">
      <div class="grid">
        <article class="card full"><h2>Co se stalo</h2><p>${descriptionHtml}</p></article>
        <article class="card full"><h2>Postup k zopakování</h2><p>${stepsHtml}</p></article>
        <article class="card">
          <h2>Technické prostředí</h2>
          <div class="meta">
            <b>Stránka</b><span>${escapeHtml(metadata.page)}</span>
            <b>Okno</b><span>${metadata.viewport.width} × ${metadata.viewport.height}px</span>
            <b>Obrazovka</b><span>${metadata.screen.width} × ${metadata.screen.height}px</span>
            <b>Platforma</b><span>${escapeHtml(metadata.platform)}</span>
            <b>Online</b><span>${metadata.online ? "ano" : "ne"}</span>
          </div>
        </article>
        <article class="card">
          <h2>Automaticky zachycené chyby</h2>
          <ul>${technicalRows}</ul>
        </article>
        <article class="card full">
          <h2>Snímky obrazovky</h2>
          <div class="shots">${screenshotHtml}</div>
        </article>
      </div>
    </section>
    <footer class="foot">
      <span>AI Studio GHRAB · provozní diagnostika</span>
      <span>Správce: Daniel Baláž</span>
    </footer>
  </main>
</body>
</html>`;
}

export function setupErrorReporter(options = {}) {
  if (!options.appId || document.getElementById(REPORTER_ID))
    return window.GHRABErrorReporter || null;
  const studioUrl = new URL(
    options.studioUrl || "/AI-Studio-GHRAB/",
    location.href,
  );
  injectStyles(options.styleUrl || LOCAL_REPORTER_STYLE_URL);
  const supportEmailPromise = loadSupportEmail(
    studioUrl,
    options.supportEmail || DEFAULT_SUPPORT_EMAIL,
  );

  const state = {
    appMeta: {
      appId: options.appId,
      name: options.appName || options.appId,
      version: options.appVersion || "—",
    },
    screenshots: [],
    stream: null,
    video: null,
    reportId: reportId(),
    preparedFile: null,
    preparedBlob: null,
    supportEmail: options.supportEmail || DEFAULT_SUPPORT_EMAIL,
    technicalErrors: [],
    completed: false,
  };
  supportEmailPromise
    .then((email) => {
      state.supportEmail = email;
      refreshPrepareLink();
    })
    .catch(() => {});
  loadAppMeta(options.appId, studioUrl).then((meta) => {
    state.appMeta = {
      ...meta,
      name: options.appName || meta.name,
      version: options.appVersion || meta.version,
    };
    updateLabels();
    refreshPrepareLink();
  });

  const pushTechnicalError = (raw) => {
    const item = {
      at: new Date().toISOString(),
      type: sanitizeTechnicalText(raw?.type || "error", 40),
      message: sanitizeTechnicalText(
        raw?.message || "Neznámá technická chyba",
        420,
      ),
      status: raw?.status ? Number(raw.status) : null,
      code: sanitizeTechnicalText(raw?.code || "", 80) || null,
      phase: sanitizeTechnicalText(raw?.phase || "", 120) || null,
      source: raw?.source ? safeTechnicalUrl(raw.source) : null,
      line: raw?.line ? Number(raw.line) : null,
      column: raw?.column ? Number(raw.column) : null,
      durationMs:
        raw?.durationMs != null
          ? Math.max(0, Math.round(Number(raw.durationMs)))
          : null,
      stack: raw?.stack
        ? sanitizeTechnicalText(safeStack(raw.stack), 1800)
        : null,
    };
    const fingerprint = [
      item.type,
      item.message,
      item.status,
      item.phase,
      item.source,
    ].join("|");
    const previous = state.technicalErrors[state.technicalErrors.length - 1];
    if (
      previous &&
      previous.fingerprint === fingerprint &&
      Date.now() - new Date(previous.at).getTime() < 3000
    )
      return;
    item.fingerprint = fingerprint;
    state.technicalErrors.push(item);
    state.technicalErrors = state.technicalErrors.slice(-20);
  };
  window.addEventListener(
    "error",
    (event) =>
      pushTechnicalError({
        type: "javascript",
        message: event.message || technicalMessage(event.error),
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack,
      }),
    { capture: true },
  );
  window.addEventListener("unhandledrejection", (event) =>
    pushTechnicalError({
      type: "promise",
      message: technicalMessage(event.reason),
      stack: event.reason?.stack,
    }),
  );
  if (!window.__GHRAB_FETCH_DIAGNOSTICS__) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const started = performance.now();
      const input = args[0];
      const init = args[1] || {};
      const requestUrl =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input?.url;
      const method = String(
        init.method || input?.method || "GET",
      ).toUpperCase();
      try {
        const response = await originalFetch(...args);
        if (!response.ok)
          pushTechnicalError({
            type: "http",
            message: `${method} ${safeTechnicalUrl(requestUrl)} skončil stavem ${response.status}`,
            status: response.status,
            code: response.statusText,
            source: requestUrl,
            durationMs: performance.now() - started,
          });
        return response;
      } catch (error) {
        pushTechnicalError({
          type: "network",
          message: technicalMessage(error),
          source: requestUrl,
          durationMs: performance.now() - started,
          stack: error?.stack,
        });
        throw error;
      }
    };
    window.__GHRAB_FETCH_DIAGNOSTICS__ = true;
  }
  window.GHRABErrorReporter = {
    ...(window.GHRABErrorReporter || {}),
    version: REPORTER_VERSION,
    appId: options.appId,
    recordTechnicalError: (payload) => pushTechnicalError(payload || {}),
  };

  const root = element("div", "ghrab-error-reporter");
  root.id = REPORTER_ID;
  root.dataset.reporterVersion = REPORTER_VERSION;
  for (const [name, value] of [
    ["--ghrab-reporter-right", options.launcherRight],
    ["--ghrab-reporter-bottom", options.launcherBottom],
    ["--ghrab-capture-right", options.captureRight],
    ["--ghrab-capture-bottom", options.captureBottom],
  ]) {
    if (value != null && String(value).trim())
      root.style.setProperty(name, String(value).trim());
  }
  const launcher = button(t("Nahlásit chybu", "Report an issue"), "launcher");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-label", t("Nahlásit chybu", "Report an issue"));
  launcher.innerHTML = `<span aria-hidden="true">!</span><strong>${t("Nahlásit chybu", "Report an issue")}</strong>`;
  const backdrop = element("div", "ghrab-report-backdrop");
  backdrop.hidden = true;
  const panel = element("section", "ghrab-report-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "ghrab-report-title");

  const header = element("header", "ghrab-report-header");
  const headerCopy = element("div");
  headerCopy.append(
    element("p", "ghrab-report-eyebrow", "AI STUDIO GHRAB"),
    element("h2", "", t("Nahlášení technické chyby", "Technical issue report")),
  );
  headerCopy.querySelector("h2").id = "ghrab-report-title";
  const closeButton = button("×", "icon");
  closeButton.setAttribute("aria-label", t("Zavřít", "Close"));
  header.append(headerCopy, closeButton);

  const appLine = element("p", "ghrab-report-app-line");
  const privacy = element("div", "ghrab-report-privacy");
  privacy.innerHTML = `<strong>${t("Nechte chybu viditelnou v celém kontextu.", "Keep the issue visible in its full context.")}</strong><span>${t("Nezakrývejte chybové hlášení ani nastavení potřebná k opravě. Pokud snímek obsahuje nesouvisející osobní údaje žáka, můžete je volitelně začernit.", "Do not hide the error message or settings needed for diagnosis. If the screenshot contains unrelated student personal data, you may redact it optionally.")}</span>`;

  const guide = document.createElement("a");
  guide.className = "ghrab-report-guide";
  guide.href = new URL(
    options.guideUrl || "manualy/error-report.html",
    studioUrl,
  ).href;
  guide.target = "_blank";
  guide.rel = "noopener";
  guide.textContent = t(
    "Otevřít krátký interaktivní návod →",
    "Open the short interactive guide →",
  );

  const captureSection = element("section", "ghrab-report-section");
  captureSection.append(
    element(
      "h3",
      "",
      t(
        "1. Pořiďte jeden nebo více snímků",
        "1. Capture one or more screenshots",
      ),
    ),
  );
  const captureHelp = element(
    "p",
    "ghrab-report-help",
    t(
      "Nejlepší výsledek získáte volbou „Tato karta“ nebo okna konkrétní aplikace. Při pořizování snímku se tento panel na okamžik skryje.",
      "For best results choose “This tab” or the application window. This panel briefly hides while a screenshot is taken.",
    ),
  );
  const captureActions = element("div", "ghrab-report-actions");
  const shareButton = button(
    t("Povolit snímání obrazovky", "Allow screen capture"),
    "primary",
  );
  const snapButton = button(
    t("Pořídit snímek", "Capture screenshot"),
    "secondary",
  );
  snapButton.disabled = true;
  const stopButton = button(t("Ukončit snímání", "Stop capture"), "ghost");
  stopButton.disabled = true;
  const leaveCaptureButton = button(
    t("Přejít do aplikace", "Go to application"),
    "secondary",
  );
  leaveCaptureButton.disabled = true;
  const uploadLabel = element(
    "label",
    "ghrab-report-button secondary",
    t("Nahrát obrázek z disku", "Upload an image"),
  );
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/png,image/jpeg,image/webp";
  uploadInput.multiple = true;
  uploadInput.hidden = true;
  uploadLabel.append(uploadInput);
  captureActions.append(
    shareButton,
    snapButton,
    leaveCaptureButton,
    stopButton,
    uploadLabel,
  );
  const captureStatus = element(
    "p",
    "ghrab-report-status",
    t("Snímání zatím není aktivní.", "Screen capture is not active yet."),
  );
  const screenshotList = element("div", "ghrab-screenshot-list");
  captureSection.append(
    captureHelp,
    captureActions,
    captureStatus,
    screenshotList,
  );

  const commentSection = element("section", "ghrab-report-section");
  commentSection.append(
    element(
      "h3",
      "",
      t("2. Stručně popište problém", "2. Briefly describe the problem"),
    ),
  );
  const commentLabel = element("label", "ghrab-report-field");
  commentLabel.append(
    element("span", "", t("Co se stalo? *", "What happened? *")),
  );
  const comment = document.createElement("textarea");
  comment.rows = 4;
  comment.maxLength = 2000;
  comment.placeholder = t(
    "Např. po kliknutí na „Vygenerovat“ se zobrazila chyba a výstup nevznikl.",
    "For example: after clicking “Generate”, an error appeared and no output was created.",
  );
  commentLabel.append(comment);
  const stepsLabel = element("label", "ghrab-report-field");
  stepsLabel.append(
    element(
      "span",
      "",
      t(
        "Jak lze chybu zopakovat? (volitelné)",
        "How can the issue be reproduced? (optional)",
      ),
    ),
  );
  const steps = document.createElement("textarea");
  steps.rows = 3;
  steps.maxLength = 2000;
  steps.placeholder = t(
    "1. Otevřel(a) jsem…  2. Vybral(a) jsem…  3. Klikl(a) jsem…",
    "1. I opened…  2. I selected…  3. I clicked…",
  );
  stepsLabel.append(steps);
  commentSection.append(commentLabel, stepsLabel);

  const sendSection = element("section", "ghrab-report-section");
  sendSection.append(
    element(
      "h3",
      "",
      t(
        "3. Připravte zprávu správci",
        "3. Prepare the report for the administrator",
      ),
    ),
  );
  const sendHelp = element(
    "p",
    "ghrab-report-help",
    t(
      "Nástroj vytvoří jeden ZIP balíček, stáhne jej a otevře předvyplněný Gmail v nové kartě. Vy pouze přiložíte stažený ZIP a zprávu odešlete. Kdyby se karta neotevřela, po přípravě se zobrazí samostatné odkazy pro Gmail i poštovní aplikaci.",
      "The tool creates one ZIP package, downloads it and opens a prefilled Gmail draft in a new tab. You only attach the downloaded ZIP and send the message. If the tab does not open, separate Gmail and mail-app links appear after preparation.",
    ),
  );
  const sendActions = element("div", "ghrab-report-actions");
  const prepareLink = document.createElement("a");
  prepareLink.className = "ghrab-report-button primary";
  prepareLink.href = "https://mail.google.com/mail/?view=cm&fs=1";
  prepareLink.target = "_blank";
  prepareLink.rel = "noopener";
  prepareLink.textContent = t(
    "Stáhnout ZIP a otevřít Gmail",
    "Download ZIP and open Gmail",
  );
  sendActions.append(prepareLink);
  const finalStatus = element("div", "ghrab-report-final");
  finalStatus.hidden = true;
  sendSection.append(sendHelp, sendActions, finalStatus);

  const footer = element("footer", "ghrab-report-footer");
  const cancelButton = button(t("Zavřít", "Close"), "ghost");
  footer.append(guide, cancelButton);
  panel.append(
    header,
    appLine,
    privacy,
    captureSection,
    commentSection,
    sendSection,
    footer,
  );
  backdrop.append(panel);
  root.append(launcher, backdrop);

  const captureBar = element("div", "ghrab-capture-bar");
  captureBar.hidden = true;
  captureBar.setAttribute("role", "region");
  captureBar.setAttribute(
    "aria-label",
    t("Ovládání snímání obrazovky", "Screen capture controls"),
  );
  const captureBarState = element("span", "ghrab-capture-bar-state");
  const captureBarTitle = element(
    "strong",
    "",
    t("Snímání obrazovky", "Screen capture"),
  );
  const captureBarCount = element("small", "", `0 / ${MAX_SCREENSHOTS}`);
  captureBarState.append(captureBarTitle, captureBarCount);
  const captureBarSnap = button(
    t("Pořídit snímek", "Capture screenshot"),
    "primary",
  );
  const captureBarBack = button(
    t("Zpět k hlášení", "Back to report"),
    "secondary",
  );
  const captureBarStop = button(
    t("Ukončit snímání", "Stop capture"),
    "ghost",
  );
  captureBar.append(
    captureBarState,
    captureBarSnap,
    captureBarBack,
    captureBarStop,
  );
  root.append(captureBar);
  document.body.append(root);
  installThemeSync(root, options);

  const editor = element("div", "ghrab-redaction-backdrop");
  editor.hidden = true;
  const editorPanel = element("section", "ghrab-redaction-panel");
  editorPanel.setAttribute("role", "dialog");
  editorPanel.setAttribute("aria-modal", "true");
  editorPanel.setAttribute("aria-label", t("Volitelné začernění osobních údajů", "Optional personal-data redaction"));
  const editorHead = element("header", "ghrab-redaction-head");
  editorHead.append(
    element(
      "div",
      "",
      t(
        "Volitelné začernění nesouvisejících osobních údajů",
        "Optional redaction of unrelated personal data",
      ),
    ),
  );
  const editorCanvasWrap = element("div", "ghrab-redaction-canvas-wrap");
  const editorCanvas = document.createElement("canvas");
  editorCanvasWrap.append(editorCanvas);
  const editorTip = element(
    "p",
    "ghrab-report-help",
    t(
      "Začerňujte pouze nesouvisející osobní údaje. Chybovou hlášku, nastavení a kontext potřebný k opravě ponechte viditelné.",
      "Redact only unrelated personal data. Keep the error message, settings and diagnostic context visible.",
    ),
  );
  const editorActions = element("div", "ghrab-report-actions");
  const undoRedaction = button(t("Vrátit poslední", "Undo last"), "secondary");
  const cancelRedaction = button(t("Zrušit", "Cancel"), "ghost");
  const saveRedaction = button(
    t("Uložit začernění", "Save redactions"),
    "primary",
  );
  editorActions.append(undoRedaction, cancelRedaction, saveRedaction);
  editorPanel.append(editorHead, editorCanvasWrap, editorTip, editorActions);
  editor.append(editorPanel);
  root.append(editor);

  const discardBackdrop = element("div", "ghrab-discard-backdrop");
  discardBackdrop.hidden = true;
  const discardDialog = element("section", "ghrab-discard-dialog");
  discardDialog.setAttribute("role", "dialog");
  discardDialog.setAttribute("aria-modal", "true");
  discardDialog.setAttribute("aria-labelledby", "ghrab-discard-title");
  const discardTitle = element(
    "h3",
    "",
    t("Co s rozepsaným hlášením?", "What should happen to this draft?"),
  );
  discardTitle.id = "ghrab-discard-title";
  const discardText = element(
    "p",
    "",
    t(
      "Hlášení obsahuje text, snímky nebo připravený balíček. Po smazání je nebude možné obnovit.",
      "The report contains text, screenshots or a prepared package. Deleted data cannot be restored.",
    ),
  );
  const discardActions = element("div", "ghrab-report-actions");
  const keepDraftButton = button(
    t("Ponechat rozepsané a zavřít", "Keep draft and close"),
    "secondary",
  );
  const deleteDraftButton = button(
    t("Smazat hlášení a zavřít", "Delete report and close"),
    "danger",
  );
  const returnToDraftButton = button(
    t("Zpět do hlášení", "Back to report"),
    "ghost",
  );
  discardActions.append(returnToDraftButton, keepDraftButton, deleteDraftButton);
  discardDialog.append(discardTitle, discardText, discardActions);
  discardBackdrop.append(discardDialog);
  root.append(discardBackdrop);

  let currentEdit = null;
  let baseEditorImage = null;
  let redactions = [];
  let dragStart = null;
  let dragCurrent = null;
  let draftCreatedAt = null;
  let draftUpdatedAt = null;
  let packageCreatedAt = null;
  let previousFocus = null;

  function updateLabels() {
    appLine.textContent = `${t("Aplikace", "Application")}: ${state.appMeta.name} · v${state.appMeta.version}`;
  }
  updateLabels();
  function open() {
    if (state.completed) resetDraft();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : launcher;
    ensureDraftCreatedAt();
    refreshPrepareLink();
    backdrop.hidden = false;
    discardBackdrop.hidden = true;
    document.documentElement.classList.add("ghrab-report-open");
    setTimeout(() => comment.focus({ preventScroll: true }), 40);
  }
  function captureIsActive() {
    return Boolean(state.stream && state.video && !snapButton.disabled);
  }
  function updateCaptureControls() {
    const active = captureIsActive();
    const count = state.screenshots.length;
    leaveCaptureButton.disabled = !active;
    captureBarSnap.disabled = !active || count >= MAX_SCREENSHOTS;
    captureBarStop.disabled = !active;
    captureBarCount.textContent = `${count} / ${MAX_SCREENSHOTS} ${t("snímků", "screenshots")}`;
  }
  function showApplicationForCapture() {
    if (!captureIsActive()) return;
    backdrop.hidden = true;
    root.classList.add("ghrab-capture-mode");
    captureBar.hidden = false;
    document.documentElement.classList.remove("ghrab-report-open");
    updateCaptureControls();
    captureBarSnap.focus({ preventScroll: true });
  }
  function showReportFromCapture() {
    root.classList.remove("ghrab-capture-mode");
    captureBar.hidden = true;
    backdrop.hidden = false;
    document.documentElement.classList.add("ghrab-report-open");
    updateCaptureControls();
    leaveCaptureButton.focus({ preventScroll: true });
  }
  function stopCapture() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    if (state.video) {
      state.video.srcObject = null;
      state.video.remove();
      state.video = null;
    }
    snapButton.disabled = true;
    stopButton.disabled = true;
    shareButton.disabled = false;
    captureStatus.textContent = t(
      "Snímání není aktivní. Již pořízené snímky zůstávají zachované.",
      "Capture is inactive. Existing screenshots remain available.",
    );
    leaveCaptureButton.disabled = true;
    captureBar.hidden = true;
    root.classList.remove("ghrab-capture-mode");
    updateCaptureControls();
  }
  function hasDraft() {
    return Boolean(
      state.screenshots.length ||
        comment.value.trim() ||
        steps.value.trim() ||
        state.preparedFile ||
        !finalStatus.hidden,
    );
  }
  function closeNow() {
    stopCapture();
    backdrop.hidden = true;
    editor.hidden = true;
    discardBackdrop.hidden = true;
    panel.removeAttribute("aria-hidden");
    document.documentElement.classList.remove("ghrab-report-open");
    const target = previousFocus && previousFocus.isConnected ? previousFocus : launcher;
    target.focus?.({ preventScroll: true });
    previousFocus = null;
  }
  function showDiscardPrompt() {
    discardBackdrop.hidden = false;
    panel.setAttribute("aria-hidden", "true");
    deleteDraftButton.focus({ preventScroll: true });
  }
  function hideDiscardPrompt() {
    discardBackdrop.hidden = true;
    panel.removeAttribute("aria-hidden");
    cancelButton.focus({ preventScroll: true });
  }
  function resetDraft() {
    stopCapture();
    state.screenshots.forEach(revokeScreenshot);
    state.screenshots = [];
    state.preparedFile = null;
    state.preparedBlob = null;
    state.reportId = reportId();
    state.technicalErrors = [];
    state.completed = false;
    draftCreatedAt = null;
    draftUpdatedAt = null;
    packageCreatedAt = null;
    comment.value = "";
    steps.value = "";
    uploadInput.value = "";
    finalStatus.replaceChildren();
    finalStatus.hidden = true;
    renderScreenshots();
    updateCaptureControls();
    setStatus(
      t("Snímání zatím není aktivní.", "Screen capture is not active yet."),
    );
    refreshPrepareLink();
  }
  function requestClose() {
    stopCapture();
    if (state.completed) closeNow();
    else if (hasDraft()) showDiscardPrompt();
    else closeNow();
  }
  function revokeScreenshot(item) {
    if (item.url) URL.revokeObjectURL(item.url);
  }
  function setStatus(message, type = "") {
    captureStatus.textContent = message;
    captureStatus.dataset.type = type;
  }
  function invalidatePreparedPackage({ touch = true } = {}) {
    ensureDraftCreatedAt();
    if (touch) draftUpdatedAt = new Date();
    state.preparedFile = null;
    state.preparedBlob = null;
    state.completed = false;
    packageCreatedAt = null;
    finalStatus.replaceChildren();
    finalStatus.hidden = true;
    refreshPrepareLink();
  }

  async function addScreenshot(blob) {
    if (state.screenshots.length >= MAX_SCREENSHOTS) {
      setStatus(
        t(
          `Lze přiložit nejvýše ${MAX_SCREENSHOTS} snímků.`,
          `You can attach up to ${MAX_SCREENSHOTS} screenshots.`,
        ),
        "warn",
      );
      return;
    }
    try {
      const normalised = await normaliseImage(blob);
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        blob: normalised,
        url: URL.createObjectURL(normalised),
      };
      state.screenshots.push(item);
      renderScreenshots();
      updateCaptureControls();
      setStatus(
        t(
          `Snímek ${state.screenshots.length}/${MAX_SCREENSHOTS} je připraven. Chybové hlášení ponechte viditelné; začernění je pouze volitelné pro nesouvisející osobní údaje.`,
          `Screenshot ${state.screenshots.length}/${MAX_SCREENSHOTS} is ready. Keep the error visible; redaction is optional only for unrelated personal data.`,
        ),
        "ok",
      );
      invalidatePreparedPackage();
    } catch {
      setStatus(
        t(
          "Obrázek se nepodařilo zpracovat.",
          "The image could not be processed.",
        ),
        "error",
      );
    }
  }
  function renderScreenshots() {
    screenshotList.replaceChildren();
    state.screenshots.forEach((item, index) => {
      const card = element("article", "ghrab-screenshot-card");
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = t(`Snímek ${index + 1}`, `Screenshot ${index + 1}`);
      const meta = element("div", "ghrab-screenshot-meta");
      meta.append(
        element(
          "strong",
          "",
          t(`Snímek ${index + 1}`, `Screenshot ${index + 1}`),
        ),
      );
      const tools = element("div", "ghrab-screenshot-tools");
      const redact = button(
        t("Začernit údaje (volitelné)", "Redact (optional)"),
        "small",
      );
      redact.addEventListener("click", () => openRedaction(item));
      const remove = button(t("Odstranit", "Remove"), "small danger");
      remove.addEventListener("click", () => {
        revokeScreenshot(item);
        state.screenshots = state.screenshots.filter(
          (candidate) => candidate.id !== item.id,
        );
        invalidatePreparedPackage();
        renderScreenshots();
        updateCaptureControls();
      });
      tools.append(redact, remove);
      meta.append(tools);
      card.append(img, meta);
      screenshotList.append(card);
    });
    if (!state.screenshots.length)
      screenshotList.append(
        element(
          "p",
          "ghrab-screenshot-empty",
          t(
            "Zatím nebyl přidán žádný snímek. Pro vytvoření diagnostického ZIPu přiložte alespoň jeden screenshot s viditelnou chybou.",
            "No screenshot has been added yet. Attach at least one screenshot with the visible issue before creating the diagnostic ZIP.",
          ),
        ),
      );
  }

  async function startCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus(
        t(
          "Tento prohlížeč neumí přímé snímání. Použijte tlačítko „Nahrát obrázek z disku“.",
          "This browser does not support direct capture. Use “Upload an image”.",
        ),
        "warn",
      );
      return;
    }
    try {
      stopCapture();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.className = "ghrab-capture-video";
      document.body.append(video);
      await video.play();
      if (!video.videoWidth)
        await new Promise((resolve) =>
          video.addEventListener("loadedmetadata", resolve, { once: true }),
        );
      state.stream = stream;
      state.video = video;
      shareButton.disabled = true;
      snapButton.disabled = false;
      stopButton.disabled = false;
      setStatus(
        t(
          "Snímání je aktivní. Hlášení zůstává otevřené; pokračujte tlačítkem „Přejít do aplikace“.",
          "Capture is active. The report remains open; continue with “Go to application”.",
        ),
        "ok",
      );
      updateCaptureControls();
      leaveCaptureButton.focus({ preventScroll: true });
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          stopCapture();
          showReportFromCapture();
        },
        { once: true },
      );
    } catch (error) {
      const denied = error?.name === "NotAllowedError";
      setStatus(
        denied
          ? t(
              "Snímání nebylo povoleno. Můžete nahrát vlastní screenshot z disku.",
              "Capture was not permitted. You can upload your own screenshot.",
            )
          : t(
              "Snímání se nepodařilo spustit.",
              "Screen capture could not be started.",
            ),
        denied ? "warn" : "error",
      );
    }
  }
  async function captureFrame() {
    if (!state.video || !state.stream) return;
    if (state.screenshots.length >= MAX_SCREENSHOTS) {
      setStatus(
        t(
          `Limit je ${MAX_SCREENSHOTS} snímků.`,
          `The limit is ${MAX_SCREENSHOTS} screenshots.`,
        ),
        "warn",
      );
      return;
    }
    root.classList.add("ghrab-capture-hidden");
    await twoFrames();
    await delay(130);
    try {
      const sourceWidth = state.video.videoWidth;
      const sourceHeight = state.video.videoHeight;
      if (!sourceWidth || !sourceHeight) throw new Error("no-frame");
      const scale = Math.min(
        1,
        MAX_CAPTURE_WIDTH / sourceWidth,
        MAX_CAPTURE_HEIGHT / sourceHeight,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      canvas
        .getContext("2d", { alpha: false })
        .drawImage(state.video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("capture-export")),
          "image/jpeg",
          JPEG_QUALITY,
        ),
      );
      await addScreenshot(blob);
    } catch {
      setStatus(
        t(
          "Aktuální snímek se nepodařilo pořídit.",
          "The current screenshot could not be captured.",
        ),
        "error",
      );
    } finally {
      root.classList.remove("ghrab-capture-hidden");
    }
  }

  function drawEditor() {
    if (!baseEditorImage) return;
    const ctx = editorCanvas.getContext("2d");
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    ctx.drawImage(
      baseEditorImage,
      0,
      0,
      editorCanvas.width,
      editorCanvas.height,
    );
    ctx.fillStyle = "#000";
    for (const rect of redactions) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (dragStart && dragCurrent) {
      const x = Math.min(dragStart.x, dragCurrent.x),
        y = Math.min(dragStart.y, dragCurrent.y),
        w = Math.abs(dragStart.x - dragCurrent.x),
        h = Math.abs(dragStart.y - dragCurrent.y);
      ctx.fillStyle = "rgba(0,0,0,.72)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
    undoRedaction.disabled = redactions.length === 0;
  }
  function canvasPoint(event) {
    const rect = editorCanvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          editorCanvas.width,
          ((event.clientX - rect.left) * editorCanvas.width) / rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          editorCanvas.height,
          ((event.clientY - rect.top) * editorCanvas.height) / rect.height,
        ),
      ),
    };
  }
  async function openRedaction(item) {
    currentEdit = item;
    baseEditorImage = await loadImage(item.blob);
    redactions = [];
    dragStart = null;
    dragCurrent = null;
    editorCanvas.width = baseEditorImage.naturalWidth;
    editorCanvas.height = baseEditorImage.naturalHeight;
    drawEditor();
    editor.hidden = false;
  }
  editorCanvas.addEventListener("pointerdown", (event) => {
    editorCanvas.setPointerCapture(event.pointerId);
    dragStart = canvasPoint(event);
    dragCurrent = dragStart;
    drawEditor();
  });
  editorCanvas.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    dragCurrent = canvasPoint(event);
    drawEditor();
  });
  editorCanvas.addEventListener("pointerup", (event) => {
    if (!dragStart) return;
    dragCurrent = canvasPoint(event);
    const x = Math.min(dragStart.x, dragCurrent.x),
      y = Math.min(dragStart.y, dragCurrent.y),
      w = Math.abs(dragStart.x - dragCurrent.x),
      h = Math.abs(dragStart.y - dragCurrent.y);
    if (w > 8 && h > 8) redactions.push({ x, y, w, h });
    dragStart = null;
    dragCurrent = null;
    drawEditor();
  });
  undoRedaction.addEventListener("click", () => {
    redactions.pop();
    drawEditor();
  });
  cancelRedaction.addEventListener("click", () => {
    editor.hidden = true;
    currentEdit = null;
    baseEditorImage = null;
    redactions = [];
  });
  saveRedaction.addEventListener("click", async () => {
    if (!currentEdit) return;
    dragStart = null;
    dragCurrent = null;
    drawEditor();
    const blob = await new Promise((resolve, reject) =>
      editorCanvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("redaction-export")),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
    revokeScreenshot(currentEdit);
    currentEdit.blob = blob;
    currentEdit.url = URL.createObjectURL(blob);
    editor.hidden = true;
    currentEdit = null;
    baseEditorImage = null;
    redactions = [];
    invalidatePreparedPackage();
    renderScreenshots();
  });

  function packageFilename(createdAt) {
    return `ghrab-hlaseni-chyby-${safeName(state.appMeta.appId)}-${nowFileStamp(createdAt)}.zip`;
  }
  function ensureDraftCreatedAt() {
    if (!draftCreatedAt) {
      draftCreatedAt = new Date();
      draftUpdatedAt = new Date(draftCreatedAt);
    }
    return draftCreatedAt;
  }
  function currentUpdatedAt() {
    ensureDraftCreatedAt();
    return draftUpdatedAt || draftCreatedAt;
  }
  function draftPackageInfo(packageAt = packageCreatedAt || new Date()) {
    const technicalErrors = state.technicalErrors
      .slice(-12)
      .map(({ fingerprint, ...item }) => item);
    const createdAt = ensureDraftCreatedAt();
    return {
      file: { name: packageFilename(packageAt) },
      metadata: {
        reportId: state.reportId,
        createdAt: createdAt.toISOString(),
        updatedAt: currentUpdatedAt().toISOString(),
        packageCreatedAt: packageAt.toISOString(),
        page: safePageUrl(),
        browser: browserLabel(),
        platform:
          navigator.userAgentData?.platform || navigator.platform || "unknown",
        viewport: { width: innerWidth, height: innerHeight },
        online: navigator.onLine,
        screenshotCount: state.screenshots.length,
      },
      description: comment.value.trim(),
      stepsText: steps.value.trim(),
      diagnostics: formatTechnicalErrors(technicalErrors),
    };
  }

  async function buildPackage(packageAt = new Date()) {
    const description = comment.value.trim();
    const stepsText = steps.value.trim();
    if (description.length < 8) {
      comment.focus();
      throw new Error(
        t(
          "Doplňte prosím krátký popis chyby.",
          "Please add a short description of the issue.",
        ),
      );
    }
    if (!state.screenshots.length) {
      throw new Error(
        t(
          "Přiložte prosím alespoň jeden screenshot s viditelnou chybou.",
          "Please attach at least one screenshot with the visible issue.",
        ),
      );
    }
    const technicalErrors = state.technicalErrors
      .slice(-12)
      .map(({ fingerprint, ...item }) => item);
    const createdAt = ensureDraftCreatedAt();
    packageCreatedAt = packageAt;
    const metadata = {
      schema: "ghrab-error-report-v3",
      reportId: state.reportId,
      createdAt: createdAt.toISOString(),
      updatedAt: currentUpdatedAt().toISOString(),
      packageCreatedAt: packageAt.toISOString(),
      appId: state.appMeta.appId,
      appName: state.appMeta.name,
      appVersion: state.appMeta.version,
      page: safePageUrl(),
      language: language(),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: devicePixelRatio || 1,
      },
      screen: { width: screen.width, height: screen.height },
      browser: browserLabel(),
      platform:
        navigator.userAgentData?.platform || navigator.platform || "unknown",
      online: navigator.onLine,
      screenshotCount: state.screenshots.length,
      technicalErrors,
    };
    const diagnostics = formatTechnicalErrors(technicalErrors);
    const reportText = [
      "AI STUDIO GHRAB – HLÁŠENÍ TECHNICKÉ CHYBY",
      `ID hlášení: ${metadata.reportId}`,
      `Aplikace: ${metadata.appName} (${metadata.appId})`,
      `Verze aplikace: ${metadata.appVersion}`,
      `Hlášení založeno: ${createdAt.toLocaleString("cs-CZ")}`,
      `Naposledy upraveno: ${currentUpdatedAt().toLocaleString("cs-CZ")}`,
      `ZIP vytvořen: ${packageAt.toLocaleString("cs-CZ")}`,
      `Stránka: ${metadata.page}`,
      "",
      "POPIS PROBLÉMU",
      description,
      "",
      "POSTUP K OPAKOVÁNÍ",
      stepsText || "Neuvedeno.",
      "",
      "AUTOMATICKY ZACHYCENÉ TECHNICKÉ CHYBY",
      ...diagnostics,
      "",
      "TECHNICKÉ PROSTŘEDÍ",
      `Okno: ${innerWidth} × ${innerHeight} px`,
      `Obrazovka: ${screen.width} × ${screen.height} px`,
      `Platforma: ${metadata.platform}`,
      `Prohlížeč: ${metadata.browser}`,
      `Online: ${metadata.online ? "ano" : "ne"}`,
      `Počet snímků: ${metadata.screenshotCount}`,
      "",
      "POZNÁMKA",
      "Snímky mají ukázat chybu v úplném kontextu. Volitelné začernění slouží pouze pro nesouvisející osobní údaje; chybové hlášení a nastavení potřebná k opravě mají zůstat viditelná.",
    ].join("\n");
    const overviewHtml = await buildOverviewHtml({
      metadata,
      description,
      stepsText,
      screenshots: state.screenshots,
      studioUrl,
    });
    const entries = [
      { name: "00-PREHLED-HLASENI.html", data: bytes(overviewHtml) },
      { name: "hlaseni.txt", data: bytes(reportText) },
      {
        name: "technicke-udaje.json",
        data: bytes(`${JSON.stringify(metadata, null, 2)}\n`),
      },
    ];
    state.screenshots.forEach((item, index) =>
      entries.push({
        name: `screenshot-${String(index + 1).padStart(2, "0")}.jpg`,
        data: item.blob,
      }),
    );
    const blob = await makeZip(entries);
    const filename = packageFilename(packageAt);
    const file = new File([blob], filename, {
      type: "application/zip",
      lastModified: packageAt.getTime(),
    });
    state.preparedBlob = blob;
    state.preparedFile = file;
    return {
      blob,
      file,
      metadata,
      reportText,
      description,
      stepsText,
      diagnostics,
    };
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function copyPrimaryScreenshot() {
    if (
      !state.screenshots.length ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === "undefined"
    )
      return false;
    try {
      const png = await pngBlobFromImage(state.screenshots[0].blob);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
  function mailDraft(packageInfo, screenshotCopied, supportEmail) {
    const subject = `[AI GHRAB] Chyba – ${state.appMeta.name} ${state.appMeta.version} – ${packageInfo.metadata.reportId}`;
    const environmentLines = [
      `posílám hlášení technické chyby v aplikaci ${state.appMeta.name}.`,
      "",
      `Aplikace: ${state.appMeta.name}`,
      `Verze: ${state.appMeta.version}`,
      `Hlášení založeno: ${new Date(packageInfo.metadata.createdAt).toLocaleString("cs-CZ")}`,
      `Naposledy upraveno: ${new Date(packageInfo.metadata.updatedAt || packageInfo.metadata.createdAt).toLocaleString("cs-CZ")}`,
      `ZIP vytvořen: ${new Date(packageInfo.metadata.packageCreatedAt || packageInfo.metadata.createdAt).toLocaleString("cs-CZ")}`,
      `ID hlášení: ${packageInfo.metadata.reportId}`,
      `Stránka: ${packageInfo.metadata.page}`,
    ];
    const closingLines = [
      `Prohlížeč / systém: ${clipText(packageInfo.metadata.browser, 420)} / ${packageInfo.metadata.platform}`,
      `Okno: ${packageInfo.metadata.viewport.width} × ${packageInfo.metadata.viewport.height}px`,
      `Online: ${packageInfo.metadata.online ? "ano" : "ne"}`,
      `Počet screenshotů: ${packageInfo.metadata.screenshotCount}`,
      "",
      screenshotCopied
        ? "Hlavní screenshot je zkopírovaný ve schránce – vložte jej do zprávy pomocí Ctrl+V."
        : "Screenshoty jsou uvnitř ZIP balíčku.",
      `PŘILOŽTE SOUBOR: ${packageInfo.file.name}`,
      "",
      "Děkuji.",
    ];
    const fitted = fitMailBodyToComposeUrl({
      to: supportEmail,
      subject,
      description: packageInfo.description,
      stepsText: packageInfo.stepsText || "Neuvedeno.",
      diagnostics: packageInfo.diagnostics.slice(0, 5),
      environmentLines,
      closingLines,
    });
    return {
      to: supportEmail,
      subject,
      body: fitted.body,
      fullBody: fitted.fullBody,
      mailtoUrl: fitted.mailtoUrl,
      gmailUrl: fitted.gmailUrl,
    };
  }
  function refreshPrepareLink() {
    if (!prepareLink) return;
    const packageAt = packageCreatedAt || new Date();
    const supportEmail = state.supportEmail || DEFAULT_SUPPORT_EMAIL;
    const draft = mailDraft(draftPackageInfo(packageAt), false, supportEmail);
    prepareLink.href = draft.gmailUrl;
    prepareLink.dataset.reportId = state.reportId;
  }

  function actionLink(label, href, className, target = "_blank") {
    const link = document.createElement("a");
    link.className = `ghrab-report-button ${className}`.trim();
    link.href = href;
    link.textContent = label;
    if (target) link.target = target;
    link.rel = "noopener";
    return link;
  }
  async function copyMailDraft(draft) {
    const text = `Komu: ${draft.to}\nPředmět: ${draft.subject}\n\n${draft.fullBody || draft.body}`;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand?.("copy") === true;
    area.remove();
    return copied;
  }
  function showPreparedMailActions(info, screenshotCopied, draft) {
    finalStatus.hidden = false;
    finalStatus.replaceChildren();
    finalStatus.append(
      element("strong", "", t("Hlášení je připravené.", "The report is ready.")),
      element(
        "span",
        "",
        t(
          `Prohlížeč dostal odkaz na předvyplněný Gmail. Pokud se nová karta neotevřela nebo ji prohlížeč zablokoval, použijte tlačítko níže. ${screenshotCopied ? "Hlavní snímek je ve schránce – v e-mailu použijte Ctrl+V. " : ""}Přiložte soubor „${info.file.name}“. Příjemce je ${draft.to}.`,
          `The browser received a link to a prefilled Gmail draft. If the new tab did not open or was blocked, use the button below. ${screenshotCopied ? "The main screenshot is in the clipboard – paste it into the email. " : ""}Attach “${info.file.name}”. The recipient is ${draft.to}.`,
        ),
      ),
    );
    const actions = element("div", "ghrab-report-actions ghrab-mail-fallback-actions");
    const gmail = actionLink(
      t("Otevřít Gmail", "Open Gmail"),
      draft.gmailUrl,
      "secondary small",
    );
    const mailApp = actionLink(
      t("Otevřít poštovní aplikaci", "Open mail app"),
      draft.mailtoUrl,
      "ghost small",
      "_blank",
    );
    const copy = button(
      t("Zkopírovat údaje e-mailu", "Copy email details"),
      "ghost small",
    );
    copy.addEventListener("click", async () => {
      try {
        const copied = await copyMailDraft(draft);
        copy.textContent = copied
          ? t("Zkopírováno", "Copied")
          : t("Kopírování se nezdařilo", "Copy failed");
      } catch {
        copy.textContent = t("Kopírování se nezdařilo", "Copy failed");
      }
    });
    actions.append(gmail, mailApp, copy);
    finalStatus.append(actions);
  }
  async function prepareAndEmail(event) {
    if (comment.value.trim().length < 8) {
      event.preventDefault();
      comment.focus();
      finalStatus.hidden = false;
      finalStatus.textContent = t(
        "Doplňte prosím krátký popis chyby (alespoň 8 znaků).",
        "Please add a short issue description (at least 8 characters).",
      );
      return;
    }
    if (!state.screenshots.length) {
      event.preventDefault();
      finalStatus.hidden = false;
      finalStatus.textContent = t(
        "Přiložte prosím alespoň jeden screenshot s viditelnou chybou.",
        "Please attach at least one screenshot with the visible issue.",
      );
      return;
    }
    if (prepareLink.getAttribute("aria-busy") === "true") {
      event.preventDefault();
      return;
    }
    ensureDraftCreatedAt();
    const packageAt = new Date();
    packageCreatedAt = packageAt;
    const initialEmail = state.supportEmail || DEFAULT_SUPPORT_EMAIL;
    const navigationDraft = mailDraft(draftPackageInfo(packageAt), false, initialEmail);
    prepareLink.href = navigationDraft.gmailUrl;
    // The complete Gmail URL is set synchronously before the first await. The
    // browser therefore performs a native target=_blank navigation without a
    // scripted popup or a last-moment href rewrite.
    prepareLink.setAttribute("aria-busy", "true");
    prepareLink.setAttribute("aria-disabled", "true");
    prepareLink.textContent = t("Připravuji ZIP…", "Preparing ZIP…");
    try {
      const info = await buildPackage(packageAt);
      const supportEmail = state.supportEmail || initialEmail;
      const screenshotCopied = await copyPrimaryScreenshot();
      const draft = mailDraft(info, screenshotCopied, supportEmail);
      downloadBlob(info.blob, info.file.name);
      state.completed = true;
      showPreparedMailActions(info, screenshotCopied, draft);
    } catch (error) {
      finalStatus.hidden = false;
      finalStatus.textContent =
        error?.message ||
        t(
          "Balíček se nepodařilo připravit.",
          "The package could not be prepared.",
        );
    } finally {
      prepareLink.removeAttribute("aria-busy");
      prepareLink.removeAttribute("aria-disabled");
      prepareLink.textContent = t(
        "Stáhnout ZIP a otevřít Gmail",
        "Download ZIP and open Gmail",
      );
    }
  }

  launcher.addEventListener("click", open);
  closeButton.addEventListener("click", requestClose);
  cancelButton.addEventListener("click", requestClose);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) requestClose();
  });
  returnToDraftButton.addEventListener("click", hideDiscardPrompt);
  keepDraftButton.addEventListener("click", closeNow);
  deleteDraftButton.addEventListener("click", () => {
    resetDraft();
    closeNow();
  });
  function visibleDialog() {
    if (!discardBackdrop.hidden) return discardDialog;
    if (!editor.hidden) return editorPanel;
    if (!backdrop.hidden) return panel;
    return null;
  }
  function trapDialogFocus(event) {
    if (event.key !== "Tab") return false;
    const dialog = visibleDialog();
    if (!dialog) return false;
    const focusable = [...dialog.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )].filter((item) => !item.hidden && item.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      dialog.setAttribute("tabindex", "-1");
      dialog.focus({ preventScroll: true });
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }
  document.addEventListener("keydown", (event) => {
    if (trapDialogFocus(event)) return;
    if (event.key !== "Escape") return;
    if (!discardBackdrop.hidden) hideDiscardPrompt();
    else if (!backdrop.hidden) requestClose();
  });
  shareButton.addEventListener("click", startCapture);
  snapButton.addEventListener("click", captureFrame);
  stopButton.addEventListener("click", stopCapture);
  leaveCaptureButton.addEventListener("click", showApplicationForCapture);
  captureBarSnap.addEventListener("click", captureFrame);
  captureBarBack.addEventListener("click", showReportFromCapture);
  captureBarStop.addEventListener("click", () => {
    stopCapture();
    showReportFromCapture();
  });
  uploadInput.addEventListener("change", async () => {
    for (const file of [...uploadInput.files].slice(
      0,
      MAX_SCREENSHOTS - state.screenshots.length,
    ))
      await addScreenshot(file);
    uploadInput.value = "";
  });
  comment.addEventListener("input", invalidatePreparedPackage);
  steps.addEventListener("input", invalidatePreparedPackage);
  prepareLink.addEventListener("click", prepareAndEmail);
  renderScreenshots();
  updateCaptureControls();
  refreshPrepareLink();
  return window.GHRABErrorReporter;
}
