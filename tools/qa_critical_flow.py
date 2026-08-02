import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

from qa_browser_common import ROOT, load_json, fulfill_route, set_document, run_steps


EXECUTABLE = os.environ.get('GHRAB_CHROMIUM_PATH') or '/usr/bin/chromium'
FLOW_TIMEOUT = 120


async def execute_flow(flow):
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=True,
        executable_path=EXECUTABLE if Path(EXECUTABLE).exists() else None,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
    )
    context = await browser.new_context(viewport=flow.get('viewport') or {'width': 1366, 'height': 768})
    page = await context.new_page()
    errors = []
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.on('pageerror', lambda err: errors.append(str(err)))
    await page.route('**/*', fulfill_route)
    await page.emulate_media(reduced_motion='reduce')

    async def scenario():
        await set_document(page, flow['url'])
        await run_steps(page, flow.get('steps'))
        body = await page.text_content('body') or ''
        if flow.get('expectedText') and flow['expectedText'] not in body:
            raise AssertionError(f"Chybí text {flow['expectedText']}")
        local_errors = [
            error for error in errors
            if '404' in error or 'Failed to load resource' in error or 'Uncaught' in error
        ]
        if local_errors:
            raise AssertionError('Konzolové chyby: ' + ' | '.join(local_errors))

    status = 'PASS'
    evidence = 'Samostatný end-to-end scénář dokončen bez chyby.'
    try:
        await asyncio.wait_for(scenario(), timeout=FLOW_TIMEOUT)
    except Exception as error:
        status = 'FAIL'
        evidence = str(error) or type(error).__name__
    finally:
        for target in (context, browser):
            try:
                await asyncio.wait_for(target.close(), timeout=5)
            except Exception:
                pass
        try:
            await asyncio.wait_for(playwright.stop(), timeout=5)
        except Exception:
            pass
    return {'id': flow['id'], 'status': status, 'evidence': evidence}


async def main():
    if len(sys.argv) != 3:
        raise SystemExit('Použití: qa_critical_flow.py FLOW_ID OUTPUT_JSON')
    flow_id, output = sys.argv[1], Path(sys.argv[2])
    plan = load_json(ROOT / 'qa' / 'critical-flows.json')
    flow = next((item for item in plan.get('flows', []) if item.get('id') == flow_id), None)
    if not flow or flow.get('type') != 'browser':
        raise SystemExit(f'Neznámý browserový scénář: {flow_id}')
    result = await execute_flow(flow)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if result['status'] == 'PASS' else 1


raise SystemExit(asyncio.run(main()))
