const DEFAULT_TIMEOUT_MS = 4000;

export function startReporterBestEffort(moduleUrl = "./error-reporter-adapter.js", options = {}) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const context = options.context || "application";
  const absoluteUrl = new URL(moduleUrl, import.meta.url).href;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Časový limit načtení diagnostického reportéru.");
      error.name = "ReporterTimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([import(absoluteUrl), timeout])
    .catch((error) => {
      console.warn("GHRAB reportér (" + context + ") nebyl načten; aplikace pokračuje bez diagnostického panelu.", error);
      return null;
    })
    .finally(() => clearTimeout(timer));
}
