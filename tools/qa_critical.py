import json
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from qa_browser_common import ROOT, load_json, finding, save_gate


FLOW_PROCESS_TIMEOUT = 180


def run_browser_flow(flow):
    with tempfile.TemporaryDirectory(prefix='lesson-hub-critical-') as directory:
        output = Path(directory) / 'result.json'
        command = [sys.executable, str(ROOT / 'tools' / 'qa_critical_flow.py'), flow['id'], str(output)]
        try:
            process = subprocess.run(
                command,
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=FLOW_PROCESS_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return {'id': flow['id'], 'status': 'FAIL', 'evidence': f'Proces překročil limit {FLOW_PROCESS_TIMEOUT} s.'}
        if output.exists():
            result = json.loads(output.read_text(encoding='utf-8'))
        else:
            message = 'Scénář nevytvořil výsledek.'
            result = {'id': flow['id'], 'status': 'FAIL', 'evidence': message[:2000]}
        return result


def main():
    plan = load_json(ROOT / 'qa' / 'critical-flows.json')
    findings = []
    matrix = []
    browser_flows = [flow for flow in plan.get('flows', []) if flow.get('type') == 'browser']
    static_flows = [flow for flow in plan.get('flows', []) if flow.get('type') == 'static']

    for flow in static_flows:
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

    browser_results = {}
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(browser_flows)))) as executor:
        futures = {executor.submit(run_browser_flow, flow): flow for flow in browser_flows}
        for future in as_completed(futures):
            flow = futures[future]
            result = future.result()
            browser_results[flow['id']] = result
            print(f"CRITICAL FLOW {flow['id']}: {result['status']} - {result['evidence']}", flush=True)
    for flow in browser_flows:
        result = browser_results[flow['id']]
        matrix.append(result)
        if result['status'] != 'PASS':
            findings.append(finding(
                'critical', 'MAJOR', 'CRITICAL_FLOW_FAILED',
                f"{flow['name']}: {result['evidence']}", flow['id'],
            ))

    result = save_gate('critical', findings, {'matrix': matrix})
    print(f"CRITICAL {result['status']}: {len(matrix)} workflow, {len(findings)} nálezů")
    return 1 if result['status'] == 'FAIL' else 0


raise SystemExit(main())
