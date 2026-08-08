import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findUnsafeHtmlAssignments, findUnsafeLocalStorage } from "./qa-security-utils.mjs";
import {
  ROOT,
  exists,
  walk,
  loadManifest,
  finding,
  gateResult,
  saveGate,
  ensureOutput,
} from "./qa-core.mjs";
await ensureOutput();
const m = await loadManifest();
const f = [];
const allowEmails = new Set(m.security?.allowedEmails || []);
const files = (
  await walk(ROOT, {
    skip: [
      "node_modules",
      "dist",
      "dist-school-server",
      "qa-results",
      ".git",
      "src/vendor",
      "vendor",
    ],
  })
).filter((p) => /\.(?:js|mjs|html|json|md|yml|yaml|css)$/.test(p));
for (const p of files) {
  const rel = path.relative(ROOT, p).split(path.sep).join("/");
  const text = await readFile(p, "utf8");
  for (const x of text.matchAll(/AIza[0-9A-Za-z_-]{35}/g))
    f.push(
      finding(
        "security",
        "BLOCKER",
        "GEMINI_KEY",
        `V ${rel} je řetězec odpovídající Gemini API klíči.`,
        x[0].slice(0, 8) + "…",
      ),
    );
  for (const x of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = x[0].toLowerCase();
    const example = /@(example\.(?:com|org|net)|example\.edu)$/.test(email);
    const testFixture =
      /(?:^|\/)(?:tests?|fixtures?)(?:\/|$)|(?:^|\/)test[^/]*\.(?:js|mjs)$|(?:interni-testy|testy-data)\.(?:js|mjs)$|^AUDIT_/i.test(
        rel,
      );
    if (!allowEmails.has(email) && !example && !testFixture)
      f.push(
        finding(
          "security",
          "MINOR",
          "EMAIL_ADDRESS",
          `E-mailová adresa v ${rel}: ${x[0]}. Ověřte, že je záměrná.`,
        ),
      );
  }
  const secretAssignments = [
    ...text.matchAll(
      /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/gi,
    ),
  ];
  for (const secretMatch of secretAssignments) {
    const value = secretMatch[1];
    const obviousSentinel = /^(?:TEST|INTERNAL|EXAMPLE|DUMMY|FAKE)[_\-]/i.test(
      value,
    );
    const testFixture =
      /(?:^|\/)(?:tests?|fixtures?)(?:\/|$)|(?:^|\/)test[^/]*\.(?:js|mjs)$|(?:interni-testy|testy-data)\.(?:js|mjs)$/i.test(
        rel,
      );
    if (!obviousSentinel && !testFixture) {
      f.push(
        finding(
          "security",
          "BLOCKER",
          "HARDCODED_SECRET",
          `Možné pevně zapsané tajemství v ${rel}.`,
        ),
      );
    }
  }
  if (/\b\d{6}\/[0-9]{3,4}\b/.test(text))
    f.push(
      finding(
        "security",
        "MAJOR",
        "PERSONAL_ID_PATTERN",
        `Možné rodné číslo v ${rel}.`,
      ),
    );
  for (const issue of findUnsafeHtmlAssignments(text, { scanRenderFunctions: /^src\/(?:ui|pages)\//.test(rel) })) {
    f.push(
      finding(
        "security",
        "MAJOR",
        "UNSAFE_HTML_INTERPOLATION",
        `Potenciálně neescapovaná interpolace do HTML v ${rel}:${issue.line}.`,
        issue.statement,
      ),
    );
  }
  for (const issue of findUnsafeLocalStorage(text)) {
    f.push(
      finding(
        "security",
        "MINOR",
        "LOCAL_STORAGE_NO_EVIDENCE",
        `V ${rel}:${issue.line} není v lokálním kontextu statický důkaz ošetření selhání localStorage.`,
        issue.statement,
      ),
    );
  }
}
if (m.features?.centralAccessGuard) {
  const guardCandidates = files.filter((p) =>
    /(?:access|guard|bootstrap|index)/i.test(path.basename(p)),
  );
  const guardTexts = await Promise.all(
    guardCandidates.map((p) => readFile(p, "utf8")),
  );
  const failOpen = guardTexts.some(
    (guardText) =>
      /Nouzový offline režim/i.test(guardText) ||
      extractCatchBodies(guardText).some((body) =>
        /(?:loadApplication\s*\(|ghrabAccess\s*=\s*["']granted["'])/i.test(
          body,
        ),
      ),
  );
  if (failOpen)
    f.push(
      finding(
        "security",
        "MAJOR",
        "OFFLINE_GUARD_FAIL_OPEN",
        "Centrální přístupová brána při chybě nebo offline stavu zpřístupňuje aplikaci bez platného ověření.",
      ),
    );
}
if (m.features?.fileExport && m.security?.requiresCsvFormulaProtection) {
  const all = (await Promise.all(files.map((p) => readFile(p, "utf8")))).join(
    "\n",
  );
  if (
    !/(?:csvFormula|formulaInjection|^[^\n]*[=+@-].*apostrophe|replace\([^)]*[=+@-])/im.test(
      all,
    )
  )
    f.push(
      finding(
        "security",
        "MAJOR",
        "CSV_FORMULA_PROTECTION_MISSING",
        "Aplikace exportuje CSV, ale nebyl nalezen důkaz ochrany proti formula injection.",
      ),
    );
}
let projectValidatorDetails = null;
if (m.security?.validator) {
  const validatorPath = path.join(ROOT, m.security.validator);
  if (!(await exists(validatorPath))) {
    f.push(
      finding(
        "security",
        "MAJOR",
        "SECURITY_VALIDATOR_MISSING",
        `Manifest vyžaduje projektový bezpečnostní validátor ${m.security.validator}, ale soubor chybí.`,
      ),
    );
  } else {
    try {
      const module = await import(
        pathToFileURL(validatorPath).href + `?qa=${Date.now()}`
      );
      if (typeof module.validateSecurity !== "function")
        throw new Error("Chybí export validateSecurity().");
      const extra = await module.validateSecurity({
        root: ROOT,
        manifest: m,
        files,
        finding,
      });
      if (Array.isArray(extra)) f.push(...extra);
      else if (extra && typeof extra === "object") {
        if (Array.isArray(extra.findings)) f.push(...extra.findings);
        projectValidatorDetails = extra.details || null;
      }
    } catch (error) {
      f.push(
        finding(
          "security",
          "BLOCKER",
          "SECURITY_VALIDATOR_CRASH",
          `Projektový bezpečnostní validátor selhal: ${error.message}`,
        ),
      );
    }
  }
}
const result = gateResult("security", f, {
  filesChecked: files.length,
  projectValidator: projectValidatorDetails,
});
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "security.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(`SECURITY ${result.status}: ${f.length} nálezů`);
if (result.status === "FAIL") process.exitCode = 1;

function extractCatchBodies(text) {
  const bodies = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let match;
  while ((match = re.exec(text))) {
    const start = re.lastIndex;
    let depth = 1,
      quote = null,
      escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "\`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        bodies.push(text.slice(start, i));
        re.lastIndex = i + 1;
        break;
      }
    }
  }
  return bodies;
}
