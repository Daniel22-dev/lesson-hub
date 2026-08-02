import json
import re
import sys
from pathlib import Path

from qa_browser_common import ROOT, load_json, finding, save_gate


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Použití: qa_critical_collect.py RESULTS_DIR')
    result_dir = Path(sys.argv[1])
    plan = load_json(ROOT / 'qa' / 'critical-flows.json')
    findings = []
    matrix = []

    for flow in [item for item in plan.get('flows', []) if item.get('type') == 'static']:
        passed = True
        evidence = []
        for assertion in flow.get('assertions', []):
            target = ROOT / assertion['file']
            text = target.read_text(encoding='utf-8') if target.exists() else ''
            match = re.search(assertion['regex'], text, re.S if 's' in assertion.get('flags', '') else 0)
            evidence.append(f"{assertion['file']}={bool(match)}")
            if not match:
                passed = False
                findings.append(finding(
                    'critical', 'MAJOR', 'STATIC_ASSERTION_FAILED',
                    f"{flow['name']}: {assertion['message']}", assertion['file'],
                ))
        matrix.append({'id': flow['id'], 'status': 'PASS' if passed else 'FAIL', 'evidence': '; '.join(evidence)})

    for flow in [item for item in plan.get('flows', []) if item.get('type') == 'browser']:
        path = result_dir / f"{flow['id']}.json"
        if not path.exists():
            result = {'id': flow['id'], 'status': 'FAIL', 'evidence': 'Chybí výsledek izolovaného scénáře.'}
        else:
            result = json.loads(path.read_text(encoding='utf-8'))
        matrix.append(result)
        if result.get('status') != 'PASS':
            findings.append(finding(
                'critical', 'MAJOR', 'CRITICAL_FLOW_FAILED',
                f"{flow['name']}: {result.get('evidence', 'Neznámá chyba')}", flow['id'],
            ))

    result = save_gate('critical', findings, {
        'matrix': matrix,
        'executionMode': 'process-isolated end-to-end scenarios',
    })
    print(f"CRITICAL {result['status']}: {len(matrix)} workflow, {len(findings)} nálezů")
    return 1 if result['status'] == 'FAIL' else 0


raise SystemExit(main())
