import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, QA_DIR, loadManifest, sha256Tree } from "./qa-core.mjs";
const args = process.argv.slice(2);
const has = (x) => args.includes(x);
const value = (x) => {
  const i = args.indexOf(x);
  return i >= 0 ? args[i + 1] : null;
};
const m = await loadManifest();
const hash = await sha256Tree(path.join(ROOT, m.buildRoot || "dist"));
const approval = {
  schema: "GHRAB-QA-MANUAL-APPROVAL-1.0.0",
  appId: m.appId,
  appVersion: m.appVersion,
  buildSha256: hash,
  manualVisualReview: has("--visual-reviewed"),
  deployedSmokeTest: has("--deployed-smoke"),
  reviewer: value("--reviewer") || process.env.USER || "unknown",
  reviewedAt: new Date().toISOString(),
  notes: value("--notes") || "",
};
await writeFile(
  path.join(QA_DIR, "manual-approval.json"),
  JSON.stringify(approval, null, 2) + "\n",
);
console.log(`Approval saved for ${m.appId} ${m.appVersion} ${hash}`);
