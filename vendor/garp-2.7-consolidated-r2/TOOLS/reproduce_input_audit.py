#!/usr/bin/env python3
"""Reproduce the LOCAL observations for one exact, previously reviewed GARP ZIP.

This is not a production security scanner. It makes no network requests and
does not modify the input archive. Requires Python 3.10+ and Node.js.
A matching result means the original findings were reproduced, NOT that GARP
or any application is secure.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

EXPECTED_SHA256 = "e21ad2dcb165465ab818caee01719182ffc8400b689c2bc73c7973c34dc9f075"
ROOT_NAME = "GARP-2.7-MASTER-WORKING"

def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def safe_extract(archive: Path, destination: Path) -> Path:
    with ZipFile(archive) as z:
        members = z.infolist()
        if len(members) > 1000 or sum(m.file_size for m in members) > 10_000_000:
            raise ValueError("Unexpected archive size.")
        for member in members:
            p = PurePosixPath(member.filename)
            if (p.is_absolute() or ".." in p.parts or "\\" in member.filename
                or ":" in member.filename or not p.parts
                or p.parts[0] != ROOT_NAME
                or stat.S_ISLNK(member.external_attr >> 16)):
                raise ValueError("Unsafe archive member.")
        z.extractall(destination)
    return destination / ROOT_NAME

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Exact original GARP ZIP")
    parser.add_argument("--output", type=Path, default=Path("garp27-local-reproduction"),
                        help="New or empty output directory")
    args = parser.parse_args()
    archive = args.archive.resolve()
    if not archive.is_file():
        raise ValueError("Archive does not exist.")
    if archive.stat().st_size > 10_000_000:
        raise ValueError("Unexpected archive size.")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError("Refusing to execute scripts from a different archive. SHA-256 mismatch.")
    node = shutil.which("node")
    if node is None:
        raise ValueError("Node.js is required but was not found in PATH.")
    output = args.output.resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("Output must be a new or empty directory.")
    output.mkdir(parents=True, exist_ok=True)
    fixtures = output / "fixtures"
    fixtures.mkdir()

    def execute(root: Path, tool: str, file: Path | None = None) -> subprocess.CompletedProcess[str]:
        command = [node, str(root / tool)]
        if file is not None:
            command.append(str(file))
        return subprocess.run(command, cwd=root, capture_output=True, text=True,
                              timeout=30, check=False)

    node_version = subprocess.check_output([node, "--version"], text=True, timeout=5).strip()
    observations: list[dict[str, object]] = []
    package_checks: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="garp27-reviewed-input-") as temp:
        root = safe_extract(archive, Path(temp))

        for tool, expected_count in [
            ("TOOLS/selftest-garp27-master.mjs", 19),
            ("TOOLS/verify-sha256s.mjs", 273),
        ]:
            run = execute(root, tool)
            try:
                report = json.loads(run.stdout)
            except json.JSONDecodeError:
                report = {}
            count = report.get("checks", report.get("checked"))
            matched = run.returncode == 0 and report.get("status") == "PASS" and count == expected_count
            package_checks.append({
                "tool": tool, "exitCode": run.returncode, "stdout": run.stdout,
                "stderr": run.stderr, "matchesOriginalObservation": matched,
            })

        def template(relative: str) -> dict:
            return json.loads((root / relative).read_text(encoding="utf-8"))

        def probe(case_id: str, tool: str, value: dict, expected_observed: str = "ACCEPT") -> None:
            f = fixtures / (case_id + ".json")
            write_json(f, value)
            run = execute(root, tool, f)
            actual = "ACCEPT" if run.returncode == 0 else "REJECT"
            observations.append({
                "caseId": case_id, "validator": tool,
                "expectedOriginalObservation": expected_observed,
                "actual": actual, "exitCode": run.returncode,
                "stdout": run.stdout, "stderr": run.stderr,
                "fixture": str(f.relative_to(output)),
                "matchesOriginalObservation": actual == expected_observed,
            })

        a = "ASSURANCE/TOOLS/validate-assurance-status.mjs"
        at = "ASSURANCE/SABLONY/security-assurance-status.template.json"
        x = template(at)
        x["overall"] = "PASS"
        x["components"][0].update(presence="MISSING", health="DOWN",
                                  effectiveness="FAIL", evidenceFreshness="STALE")
        probe("ASSURANCE_PASS_WITH_FAILED_COMPONENT", a, x)
        x = template(at)
        x["overall"] = "PASS"
        x["components"][0].update(health="HEALTHY", effectiveness="PASS", evidenceFreshness="FRESH")
        probe("ASSURANCE_PASS_WITHOUT_EVIDENCE", a, x)
        x = template(at)
        del x["environment"]
        probe("ASSURANCE_MISSING_REQUIRED_ENVIRONMENT", a, x)
        x = template(at)
        x["components"].append(x["components"][0].copy())
        probe("ASSURANCE_DUPLICATE_COMPONENT", a, x)
        x = template(at)
        x["garpVersion"] = "2.7"
        probe("ASSURANCE_REJECTS_27", a, x, "REJECT")

        b = "AUTO-PATCH-GUARD/TOOLS/validate-auto-patch-manifest.mjs"
        bt = "AUTO-PATCH-GUARD/SABLONY/auto-patch-manifest.template.json"
        x = template(bt)
        x.update(state="COMMITTED", gates={})
        probe("APG_COMMITTED_EMPTY_GATES", b, x)
        x = template(bt)
        x["state"] = "COMMITTED"
        del x["gates"]
        probe("APG_COMMITTED_MISSING_GATES", b, x)
        x = template(bt)
        x["state"] = "COMMITTED"
        x["gates"] = {k: "N/A" for k in x["gates"]}
        probe("APG_COMMITTED_ALL_GATES_NA", b, x)
        x = template(bt)
        x["state"] = "COMMITTED"
        x["gates"] = {k: "PASS" for k in x["gates"]}
        probe("APG_COMMITTED_SOURCE_NOT_ALLOWED_NO_EVIDENCE", b, x)
        x = template(bt)
        del x["policy"]
        probe("APG_MISSING_REQUIRED_POLICY", b, x)
        x = template(bt)
        x["garpVersion"] = "2.7"
        probe("APG_REJECTS_27", b, x, "REJECT")

        x = template("SHIELD-LIVE/SABLONY/garp-live-profile.template.json")
        x["overall"] = "PASS"
        x["controls"] = {k: "PASS" for k in x["controls"]}
        probe("LIVE_PASS_WITHOUT_SERVER_EVIDENCE", "SHIELD-LIVE/TOOLS/validate-live-profile.mjs", x)
        x = template("FOUNDATION/SABLONY/garp-policy.template.json")
        for k in ["identity", "incident", "securityHealth", "inventory"]:
            x[k] = {}
        probe("POLICY_EMPTY_CRITICAL_SECTIONS", "FOUNDATION/TOOLS/validate-garp-policy.mjs", x)

    reproduced = all(c["matchesOriginalObservation"] for c in package_checks + observations)
    report = {
        "meaning": "Reproduction of original local findings; NOT an application-security PASS.",
        "inputSha256": digest, "nodeVersion": node_version,
        "networkAccessRequired": False,
        "status": "ORIGINAL_FINDINGS_REPRODUCED" if reproduced else "OBSERVATIONS_DIFFER",
        "packageChecks": package_checks, "probes": observations,
    }
    write_json(output / "reproduction-result.json", report)
    print(json.dumps({
        "status": report["status"], "probes": len(observations),
        "matchedProbes": sum(bool(x["matchesOriginalObservation"]) for x in observations),
        "report": str(output / "reproduction-result.json"),
        "warning": report["meaning"],
    }, indent=2))
    return 0 if reproduced else 1

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        raise SystemExit(2)
