import json
import sys
from pathlib import Path

from qa_browser_common import ROOT, load_json, finding, save_gate


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Použití: qa_visual_collect.py RESULTS_DIR')
    result_dir = Path(sys.argv[1])
    plan = load_json(ROOT / 'qa' / 'visual-plan.json')
    matrix = []
    findings = []
    for scenario in plan.get('scenarios', []):
        path = result_dir / f"{scenario['id']}.json"
        if not path.exists():
            rows = [{'scenario': scenario['id'], 'name': scenario.get('name', scenario['id']), 'viewport': 'setup', 'status': 'FAIL', 'message': 'Chybí výsledek izolovaného scénáře.', 'screenshot': ''}]
        else:
            rows = json.loads(path.read_text(encoding='utf-8')).get('matrix', [])
        matrix.extend(rows)
        for row in rows:
            if row.get('status') != 'PASS':
                findings.append(finding('visual', 'MAJOR', 'VISUAL_SCENARIO_FAILED', f"{row.get('name', scenario['id'])} {row.get('viewport')}: {row.get('message')}", row.get('screenshot', '')))
    result = save_gate('visual', findings, {'matrix': matrix, 'screenshots': len(matrix), 'executionMode': 'process-isolated visual scenarios'})
    print(f"VISUAL {result['status']}: {len(matrix)} snímků, {len(findings)} nálezů")
    return 1 if result['status'] == 'FAIL' else 0

raise SystemExit(main())
