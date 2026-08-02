import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  OUT_DIR,
  QA_DIR,
  exists,
  readJson,
  loadManifest,
  loadState,
  sha256Tree,
  csvCell,
  ensureOutput,
  finding,
  gateResult,
} from "./qa-core.mjs";

const REQUIRED_GATES = [
  "project",
  "technical",
  "security",
  "pwa",
  "combinatorial",
  "visual",
  "critical",
];

await ensureOutput();
const manifest = await loadManifest();
const state = await loadState();
state.gates ||= {};
for (const gate of REQUIRED_GATES) {
  if (!state.gates[gate]) {
    state.gates[gate] = gateResult(gate, [
      finding(
        gate,
        "BLOCKER",
        "REQUIRED_GATE_MISSING",
        `Povinná brána ${gate} nemá výsledek z aktuálního průchodu.`,
      ),
    ]);
  }
}
const gates = REQUIRED_GATES.map((name) => state.gates[name]);
const findings = gates.flatMap((gate) => gate.findings || []);
const skipped = state.skipped || [];
if (process.env.GITHUB_ACTIONS && skipped.length) {
  findings.push(...skipped.map((item) => finding(
    "project",
    "BLOCKER",
    "CI_CHECK_SKIPPED",
    `V CI byla přeskočena povinná kontrola ${item.check}: ${item.reason}`,
  )));
}
const buildHash = await sha256Tree(
  path.join(ROOT, manifest.buildRoot || "dist"),
);
let approval = null;
if (await exists(path.join(QA_DIR, "manual-approval.json"))) {
  approval = await readJson(path.join(QA_DIR, "manual-approval.json"));
}
const approvalValid = Boolean(
  approval &&
  approval.appId === manifest.appId &&
  approval.appVersion === manifest.appVersion &&
  approval.buildSha256 === buildHash,
);
const manualVisual = Boolean(approvalValid && approval.manualVisualReview);
const smoke = Boolean(approvalValid && approval.deployedSmokeTest);
const blocker = findings.some((item) => item.severity === "BLOCKER");
const major = findings.some((item) => item.severity === "MAJOR");
const minor = findings.some((item) => item.severity === "MINOR");
const verdict =
  blocker || major
    ? "NOT_READY"
    : skipped.length
      ? "AUTOMATED_INCOMPLETE"
      : manualVisual && smoke
        ? minor
          ? "READY_WITH_MINOR_ISSUES"
          : "READY"
        : "AUTOMATED_READY";
const counts = {
  PASS: gates.filter((gate) => gate.status === "PASS").length,
  WARN: gates.filter((gate) => gate.status === "WARN").length,
  FAIL: gates.filter((gate) => gate.status === "FAIL").length,
};
const report = {
  application: manifest.appName,
  appId: manifest.appId,
  version: manifest.appVersion,
  qaStandard: manifest.standard,
  date: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  buildSha256: buildHash,
  gates,
  counts,
  blockerAndMajor: findings.filter((item) =>
    ["BLOCKER", "MAJOR"].includes(item.severity),
  ),
  minor: findings.filter((item) => item.severity === "MINOR"),
  skipped,
  manualApproval: {
    present: Boolean(approval),
    valid: approvalValid,
    manualVisualReview: manualVisual,
    deployedSmokeTest: smoke,
    reviewer: approvalValid ? approval.reviewer : null,
  },
  automaticVerdict: blocker || major ? "NOT_READY" : "AUTOMATED_READY",
  verdict,
};
await writeFile(
  path.join(OUT_DIR, "qa-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(path.join(OUT_DIR, "release-verdict.txt"), `${verdict}\n`);
const rows = gates
  .map(
    (gate) =>
      `<tr><td>${escapeHtml(gate.name)}</td><td class="${escapeHtml(gate.status)}">${escapeHtml(gate.status)}</td><td>${Number(gate.findings.length)}</td></tr>`,
  )
  .join("");
const issues =
  findings
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.gate)}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.message)}</td></tr>`,
    )
    .join("") || '<tr><td colspan="4">Žádné nálezy.</td></tr>';
const html = `<!doctype html><meta charset="utf-8"><title>GHRAB QA — ${escapeHtml(manifest.appName)}</title><style>body{font:15px system-ui;margin:32px;max-width:1200px;color:#172033}h1{margin-bottom:4px}.verdict{font-size:24px;font-weight:800;padding:16px;border:2px solid #172033;border-radius:12px}.PASS{color:#08783d}.WARN{color:#9b6500}.FAIL{color:#b42318}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ccd2dc;padding:8px;text-align:left}th{background:#eef1f5}code{word-break:break-all}</style><h1>${escapeHtml(manifest.appName)} ${escapeHtml(manifest.appVersion)}</h1><p>${escapeHtml(manifest.standard)}</p><div class="verdict">${escapeHtml(verdict)}</div><p>SHA-256 buildu: <code>${escapeHtml(buildHash)}</code></p><h2>Brány</h2><table><tr><th>Brána</th><th>Stav</th><th>Nálezy</th></tr>${rows}</table><h2>Nálezy</h2><table><tr><th>Závažnost</th><th>Brána</th><th>Kód</th><th>Popis</th></tr>${issues}</table><h2>Ruční potvrzení</h2><p>Platné: ${approvalValid ? "ano" : "ne"} · galerie: ${manualVisual ? "ano" : "ne"} · deployed smoke test: ${smoke ? "ano" : "ne"}</p>`;
await writeFile(path.join(OUT_DIR, "qa-report.html"), html);
const visual = state.gates.visual?.details?.matrix || [];
const combinatorial = state.gates.combinatorial?.details?.matrix || [];
const csv =
  [
    "type,scenario,viewport,status,message,evidence,parameters,screenshot",
    ...visual.map((row) =>
      [
        "visual",
        row.scenario,
        row.viewport,
        row.status,
        row.message,
        "",
        "",
        row.screenshot,
      ]
        .map(csvCell)
        .join(","),
    ),
    ...combinatorial.map((row) =>
      [
        "pairwise",
        row.id,
        "",
        row.status,
        "",
        row.evidence,
        JSON.stringify(row.parameters),
        "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n") + "\n";
await writeFile(path.join(OUT_DIR, "qa-test-matrix.csv"), csv);
const visualMark = manualVisual ? "x" : " ";
const smokeMark = smoke ? "x" : " ";
const checklist = `# Ruční kontrola galerie — ${manifest.appName} ${manifest.appVersion}

- [${visualMark}] Otevřel/a jsem všechny soubory v \`qa-screenshots/\`.
- [${visualMark}] Žádná obrazovka není prázdná, skrytá ani zakrytá overlayem.
- [${visualMark}] Texty nejsou oříznuté, poškozené ani nahrazené uvnitř vlastních jmen.
- [${visualMark}] Kritická tlačítka jsou dostupná na mobilu i desktopu.
- [${visualMark}] Ověřil/a jsem rizikové scénáře a dlouhý obsah.
- [${smokeMark}] Provedl/a jsem deployed smoke test stejného buildu.

Build SHA-256: \`${buildHash}\`
`;
await writeFile(path.join(OUT_DIR, "manual-review-checklist.md"), checklist);
console.log(`REPORT ${verdict} ${buildHash}`);

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
