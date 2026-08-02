import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  QA_DIR,
  exists,
  readJson,
  finding,
  gateResult,
  saveGate,
  ensureOutput,
} from "./qa-core.mjs";

await ensureOutput();
const planPath = path.join(QA_DIR, "combinatorial-plan.json");
const findings = [];
if (!(await exists(planPath))) {
  findings.push(
    finding(
      "combinatorial",
      "MAJOR",
      "PLAN_MISSING",
      "Chybí qa/combinatorial-plan.json.",
    ),
  );
  const result = gateResult("combinatorial", findings, {});
  await saveGate(result);
  await writeFile(
    path.join(ROOT, "qa-results", "combinatorial.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(`COMBINATORIAL ${result.status}: ${findings.length} nálezů`);
  process.exit(1);
}
const plan = await readJson(planPath);
const names = Object.keys(plan.parameters || {});
if (names.length < 2)
  findings.push(
    finding(
      "combinatorial",
      "MAJOR",
      "PARAMETERS_INSUFFICIENT",
      "Pairwise plán musí mít alespoň dva parametry.",
    ),
  );
for (const name of names)
  if (!Array.isArray(plan.parameters[name]) || !plan.parameters[name].length)
    findings.push(
      finding(
        "combinatorial",
        "MAJOR",
        "PARAMETER_EMPTY",
        `Parametr ${name} nemá hodnoty.`,
      ),
    );

const combos = cartesian(names, plan.parameters || {});
const theoretical = combos.length;
if (theoretical > 100000)
  findings.push(
    finding(
      "combinatorial",
      "MAJOR",
      "SPACE_TOO_LARGE",
      `Teoretický prostor ${theoretical} kombinací překračuje bezpečný limit 100000.`,
    ),
  );
const pairUniverse = makePairUniverse(names, plan.parameters || {});
const selected = [];
const selectedKeys = new Set();
for (const fixed of [
  ...(plan.fixedScenarios || []),
  ...(plan.criticalTriples || []),
])
  addBestMatching(fixed);
const uncovered = new Set(pairUniverse);
for (const row of selected)
  for (const key of pairKeys(row, names)) uncovered.delete(key);
while (uncovered.size) {
  let best = null,
    score = -1;
  for (const row of combos) {
    const key = stable(row, names);
    if (selectedKeys.has(key)) continue;
    let current = 0;
    for (const p of pairKeys(row, names)) if (uncovered.has(p)) current++;
    if (current > score) {
      score = current;
      best = row;
    }
  }
  if (!best || score <= 0) break;
  add(best);
  for (const p of pairKeys(best, names)) uncovered.delete(p);
}
if (uncovered.size)
  findings.push(
    finding(
      "combinatorial",
      "MAJOR",
      "PAIRWISE_INCOMPLETE",
      `Nepokryto ${uncovered.size} dvojic hodnot.`,
    ),
  );

let validate = async () => ({
  pass: true,
  evidence: "Matice byla vygenerována a pokrytí ověřeno.",
});
if (plan.validator) {
  const validatorPath = path.resolve(ROOT, plan.validator);
  if (!(await exists(validatorPath)))
    findings.push(
      finding(
        "combinatorial",
        "MAJOR",
        "VALIDATOR_MISSING",
        `Chybí validátor ${plan.validator}.`,
      ),
    );
  else {
    const mod = await import(
      pathToFileURL(validatorPath).href + `?t=${Date.now()}`
    );
    if (typeof mod.validateScenario !== "function")
      findings.push(
        finding(
          "combinatorial",
          "MAJOR",
          "VALIDATOR_INVALID",
          `Validátor ${plan.validator} neexportuje validateScenario.`,
        ),
      );
    else validate = mod.validateScenario;
  }
}
const matrix = [];
if (!findings.some((x) => x.severity === "MAJOR" || x.severity === "BLOCKER")) {
  for (let i = 0; i < selected.length; i++) {
    const scenario = selected[i];
    try {
      const out = await validateScenarioWithTimeout(
        validate,
        scenario,
        { root: ROOT, plan, index: i },
        plan.timeoutMs || 10000,
      );
      const pass = out === true || out?.pass === true;
      matrix.push({
        id: `PW-${String(i + 1).padStart(3, "0")}`,
        status: pass ? "PASS" : "FAIL",
        parameters: scenario,
        evidence: out?.evidence || "",
      });
      if (!pass)
        findings.push(
          finding(
            "combinatorial",
            "MAJOR",
            "SCENARIO_FAIL",
            `Pairwise scénář ${i + 1} selhal: ${out?.message || "validátor vrátil FAIL"}`,
            JSON.stringify(scenario),
          ),
        );
    } catch (error) {
      matrix.push({
        id: `PW-${String(i + 1).padStart(3, "0")}`,
        status: "FAIL",
        parameters: scenario,
        evidence: String(error),
      });
      findings.push(
        finding(
          "combinatorial",
          "MAJOR",
          "SCENARIO_ERROR",
          `Pairwise scénář ${i + 1} skončil chybou: ${error.message}`,
          JSON.stringify(scenario),
        ),
      );
    }
  }
}
const coveredPairs = pairUniverse.length - uncovered.size;
const result = gateResult("combinatorial", findings, {
  parameters: names.length,
  parameterValues: plan.parameters,
  theoreticalCombinations: theoretical,
  executedScenarios: matrix.length,
  pairwisePairs: pairUniverse.length,
  coveredPairs,
  pairwiseCoveragePercent: pairUniverse.length
    ? Number(((coveredPairs * 100) / pairUniverse.length).toFixed(2))
    : 0,
  criticalTriples: plan.criticalTriples || [],
  fixedScenarios: plan.fixedScenarios || [],
  matrix,
  limitations: plan.limitations || [],
});
await saveGate(result);
await writeFile(
  path.join(ROOT, "qa-results", "combinatorial.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `COMBINATORIAL ${result.status}: ${matrix.length}/${theoretical} scénářů, pairwise ${result.details.pairwiseCoveragePercent}%`,
);
process.exit(result.status === "FAIL" ? 1 : 0);

function add(row) {
  const key = stable(row, names);
  if (!selectedKeys.has(key)) {
    selectedKeys.add(key);
    selected.push(row);
  }
}
function addBestMatching(partial) {
  const match = combos.find((row) =>
    Object.entries(partial).every(([k, v]) => row[k] === v),
  );
  if (match) add(match);
  else
    findings.push(
      finding(
        "combinatorial",
        "MAJOR",
        "CRITICAL_SCENARIO_INVALID",
        `Kritický scénář neodpovídá hodnotám parametrů: ${JSON.stringify(partial)}`,
      ),
    );
}
function cartesian(keys, values, i = 0, row = {}, out = []) {
  if (i === keys.length) {
    out.push({ ...row });
    return out;
  }
  const k = keys[i];
  for (const v of values[k]) {
    row[k] = v;
    cartesian(keys, values, i + 1, row, out);
  }
  return out;
}
function stable(row, keys) {
  return keys.map((k) => `${k}=${JSON.stringify(row[k])}`).join("|");
}
function pairKey(a, av, b, bv) {
  return `${a}=${JSON.stringify(av)}::${b}=${JSON.stringify(bv)}`;
}
function pairKeys(row, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      out.push(pairKey(keys[i], row[keys[i]], keys[j], row[keys[j]]));
  return out;
}
function makePairUniverse(keys, values) {
  const out = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      for (const a of values[keys[i]])
        for (const b of values[keys[j]])
          out.push(pairKey(keys[i], a, keys[j], b));
  return out;
}
function validateScenarioWithTimeout(fn, scenario, context, ms) {
  return Promise.race([
    Promise.resolve(fn(scenario, context)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Validátor překročil ${ms} ms`)), ms),
    ),
  ]);
}
