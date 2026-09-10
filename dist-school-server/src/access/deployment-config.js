const CONFIG_SCHEMA = "ghrab-deployment-config-v1";
const CONFIG_VERSION = 1;
const DEFAULT_STUDIO_BASE_URL = "/AI-Studio-GHRAB/";
const MODULE_ROOT_URL = new URL("../", import.meta.url);
const DEFAULT_CONFIG_URL = new URL("config/deployment.json", MODULE_ROOT_URL);
const DEFAULT_APP_BASE_URLS = Object.freeze({
  "ai-studio": "/AI-Studio-GHRAB/",
  differentiator: "/diferenciator/",
  generator: "/generator-testu/",
  "essay-evaluator": "/Hodnotitel-maturitnich-slohu/",
  correspondence: "/korespondencni-asistent/",
  "lesson-hub": "/lesson-hub/",
  ludus: "/Ludus/",
  "activity-builder": "/Sestavovac-aktivit/",
  sortio: "/SORTIO/",
});
const promiseCache = new Map();

function trailingSlash(value, fallback = "./") {
  const text = String(value || "").trim() || fallback;
  return text.endsWith("/") ? text : `${text}/`;
}

function resolveUrl(value, base = MODULE_ROOT_URL, fallback = "./") {
  return new URL(trailingSlash(value, fallback), base).href;
}

async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController();
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("Časový limit načtení deployment konfigurace.");
      error.name = "DeploymentConfigTimeoutError";
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function validate(raw) {
  if (!raw || typeof raw !== "object") {
    throw new TypeError("Deployment konfigurace musí být objekt.");
  }
  if (raw.schema !== CONFIG_SCHEMA || Number(raw.version) !== CONFIG_VERSION) {
    throw new TypeError("Nepodporovaná verze deployment konfigurace.");
  }
  for (const field of [
    "environmentId",
    "profile",
    "studioBaseUrl",
    "sharedAccessVersion",
  ]) {
    if (!String(raw[field] || "").trim()) {
      throw new TypeError(`Deployment konfigurace neobsahuje ${field}.`);
    }
  }
  if (
    !raw.appBaseUrls ||
    typeof raw.appBaseUrls !== "object" ||
    Array.isArray(raw.appBaseUrls)
  ) {
    throw new TypeError("Deployment konfigurace neobsahuje appBaseUrls.");
  }
  if (!Array.isArray(raw.allowedOrigins) || !raw.allowedOrigins.length) {
    throw new TypeError("Deployment konfigurace neobsahuje allowedOrigins.");
  }
  return raw;
}

function fallbackConfig() {
  return {
    schema: CONFIG_SCHEMA,
    version: CONFIG_VERSION,
    environmentId: "github-pages-fallback",
    profile: "github-pages",
    studioBaseUrl: DEFAULT_STUDIO_BASE_URL,
    appBaseUrls: { ...DEFAULT_APP_BASE_URLS },
    assetBaseUrl: "./",
    apiBaseUrl: "",
    allowedOrigins: ["self", "https://daniel22-dev.github.io"],
    sharedAccessVersion: "p0-fallback",
    authMode: "signed-permit",
    aiTransport: "direct-provider",
    telemetryMode: "local",
    features: {
      schoolServerReady: true,
      allowLocalProviderKeys: true,
      serverSessionReady: false,
      schoolGatewayReady: false,
    },
  };
}

function normalise(raw, appId) {
  const originBase = new URL("/", location.href);
  const studioBaseUrl = resolveUrl(
    raw.studioBaseUrl,
    originBase,
    DEFAULT_STUDIO_BASE_URL,
  );
  const appBaseUrls = Object.fromEntries(
    Object.entries({ ...DEFAULT_APP_BASE_URLS, ...raw.appBaseUrls }).map(
      ([id, value]) => [
        id,
        resolveUrl(
          value,
          value?.startsWith?.("/") ? originBase : MODULE_ROOT_URL,
          "./",
        ),
      ],
    ),
  );
  const appBaseUrl = appBaseUrls[appId] || MODULE_ROOT_URL.href;
  const assetBaseUrl = resolveUrl(
    raw.assetBaseUrl || "./",
    MODULE_ROOT_URL,
    "./",
  );
  const apiBaseUrl = raw.apiBaseUrl
    ? resolveUrl(
        raw.apiBaseUrl,
        raw.apiBaseUrl.startsWith("/") ? originBase : MODULE_ROOT_URL,
        "./",
      )
    : "";
  return Object.freeze({
    ...raw,
    appId,
    studioBaseUrl,
    appBaseUrls: Object.freeze(appBaseUrls),
    appBaseUrl,
    assetBaseUrl,
    apiBaseUrl,
    allowedOrigins: Object.freeze([...raw.allowedOrigins]),
    features: Object.freeze({ ...(raw.features || {}) }),
    access: Object.freeze({
      guardUrl: new URL("access/app-guard.js", studioBaseUrl).href,
      gateCssUrl: new URL("access/access-gate.css", studioBaseUrl).href,
      guideUrl: new URL("manualy/error-report.html", studioBaseUrl).href,
      accessPageUrl: new URL("access/", studioBaseUrl).href,
    }),
  });
}

function applyDeploymentLinks(config) {
  const mappings = [
    ["[data-ghrab-studio-link],a[href=\"/AI-Studio-GHRAB/\"]", config.studioBaseUrl],
    ["[data-ghrab-access-link]", config.access.accessPageUrl],
    ["[data-ghrab-report-guide],[data-ghrab-guide-link],a[href=\"/AI-Studio-GHRAB/manualy/error-report.html\"]", config.access.guideUrl],
  ];
  for (const [selector, href] of mappings) {
    document.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLAnchorElement) element.href = href;
    });
  }
  document.querySelectorAll("[data-ghrab-app-link]").forEach((element) => {
    if (!(element instanceof HTMLAnchorElement)) return;
    const targetAppId = element.dataset.ghrabAppLink;
    if (targetAppId && config.appBaseUrls[targetAppId]) {
      element.href = config.appBaseUrls[targetAppId];
    }
  });
}

export async function loadDeploymentConfig({
  appId,
  timeoutMs = 3000,
  forceReload = false,
} = {}) {
  if (!appId) throw new TypeError("loadDeploymentConfig vyžaduje appId.");
  const configUrl = globalThis.__GHRAB_DEPLOYMENT_CONFIG_URL__
    ? new URL(globalThis.__GHRAB_DEPLOYMENT_CONFIG_URL__, MODULE_ROOT_URL)
    : DEFAULT_CONFIG_URL;
  const cacheKey = configUrl.href;
  if (forceReload) promiseCache.delete(cacheKey);
  if (!promiseCache.has(cacheKey)) {
    promiseCache.set(
      cacheKey,
      (async () => {
        const inline = globalThis.__GHRAB_DEPLOYMENT_CONFIG_OVERRIDE__;
        if (inline) return validate(inline);
        try {
          const response = await fetchWithTimeout(
            configUrl,
            {
              cache: "no-store",
              credentials: "same-origin",
            },
            Math.max(250, Number(timeoutMs || 3000)),
          );
          if (!response.ok) {
            throw new Error(
              `Deployment konfigurace skončila stavem ${response.status}.`,
            );
          }
          return validate(await response.json());
        } catch (error) {
          console.warn(
            "GHRAB deployment konfigurace není dostupná; používám bezpečný GitHub fallback.",
            error,
          );
          return fallbackConfig();
        }
      })(),
    );
  }
  const config = normalise(await promiseCache.get(cacheKey), appId);
  globalThis.__GHRAB_DEPLOYMENT_CONFIG__ = config;
  globalThis.__GHRAB_STUDIO_URL__ = config.studioBaseUrl;
  document.documentElement.dataset.ghrabEnvironment = config.environmentId;
  document.documentElement.dataset.ghrabProfile = config.profile;
  applyDeploymentLinks(config);
  return config;
}

export function originIsAllowed(config, candidate = location.href) {
  const origin = new URL(candidate, location.href).origin;
  return config.allowedOrigins.some((entry) =>
    entry === "self"
      ? origin === location.origin
      : origin === new URL(entry, location.href).origin,
  );
}

export function currentLocationMatchesApp(config, appId = config.appId) {
  if (
    location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  ) {
    return true;
  }
  if (!originIsAllowed(config)) return false;
  const expected = new URL(config.appBaseUrls?.[appId] || config.appBaseUrl);
  const current = new URL(location.href);
  return (
    current.origin === expected.origin &&
    current.pathname.startsWith(expected.pathname)
  );
}

export function ensureAccessGateStylesheet(config) {
  const href = config?.access?.gateCssUrl;
  if (!href) return null;
  let link = document.querySelector("link[data-ghrab-access-gate]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.ghrabAccessGate = "true";
    document.head.append(link);
  }
  if (link.href !== href) link.href = href;
  return link;
}

export function deploymentUrls(config) {
  return Object.freeze({
    studioUrl: config.studioBaseUrl,
    appBaseUrl: config.appBaseUrl,
    appBaseUrls: config.appBaseUrls,
    assetBaseUrl: config.assetBaseUrl,
    apiBaseUrl: config.apiBaseUrl,
    guardUrl: config.access.guardUrl,
    gateCssUrl: config.access.gateCssUrl,
    guideUrl: config.access.guideUrl,
    reporterGuideUrl: config.access.guideUrl,
    accessPageUrl: config.access.accessPageUrl,
  });
}

export function appUrl(config, appId, relative = "") {
  const base = config.appBaseUrls?.[appId] || config.appBaseUrl;
  return new URL(relative, base).href;
}

export function applyDeploymentToAppRegistry(config, apps = []) {
  if (!Array.isArray(apps)) return [];
  return apps.map((app) => {
    const launchUrl = config?.appBaseUrls?.[app?.id];
    if (!launchUrl) return app;
    const aiCore = app?.aiCore && typeof app.aiCore === "object"
      ? Object.freeze({
          ...app.aiCore,
          operationsManifestUrl: app.aiCore.operationsManifestUrl
            ? new URL("ai-operations.json", launchUrl).href
            : app.aiCore.operationsManifestUrl,
        })
      : app?.aiCore;
    return Object.freeze({
      ...app,
      launchUrl,
      manualUrl: new URL("manual/", launchUrl).href,
      ...(aiCore ? { aiCore } : {}),
    });
  });
}

export const DEPLOYMENT_CONFIG_SCHEMA = CONFIG_SCHEMA;
export const DEPLOYMENT_CONFIG_VERSION = CONFIG_VERSION;
