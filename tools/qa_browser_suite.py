import asyncio
import os
import re
from pathlib import Path
from playwright.async_api import async_playwright
from qa_browser_common import (
    ROOT,
    SCREEN_DIR,
    load_json,
    finding,
    save_gate,
    fulfill_route,
    set_document,
    run_steps,
)


async def run_critical(browser):
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
                findings.append(
                    finding(
                        'critical',
                        'MAJOR',
                        'STATIC_ASSERTION_FAILED',
                        f"{flow['name']}: {assertion['message']}",
                        assertion['file'],
                    )
                )
        matrix.append({'id': flow['id'], 'status': 'PASS' if passed else 'FAIL', 'evidence': '; '.join(evidence)})

    context = await browser.new_context(viewport={'width': 1366, 'height': 768}, reduced_motion='reduce', service_workers='block')
    page = await context.new_page()
    errors = []
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.on('pageerror', lambda err: errors.append(str(err)))
    await page.route('**/*', fulfill_route)

    initialized = False
    for flow in browser_flows:
        status = 'PASS'
        evidence = ''
        errors.clear()
        try:
            if not initialized:
                await set_document(page, flow['url'])
                initialized = True
            else:
                fragment = flow['url'].split('#', 1)[1] if '#' in flow['url'] else '/overview'
                await page.evaluate('(hash) => { location.hash = hash; }', '#' + fragment)
                await page.wait_for_timeout(350)
            await run_steps(page, flow.get('steps'))
            body = await page.text_content('body') or ''
            if flow.get('expectedText') and flow['expectedText'] not in body:
                raise AssertionError(f"Chybí text {flow['expectedText']}")
            local_errors = [e for e in errors if '404' in e or 'Failed to load resource' in e or 'Uncaught' in e]
            if local_errors:
                raise AssertionError('Konzolové chyby: ' + ' | '.join(local_errors))
            evidence = 'Workflow dokončen bez chyby.'
        except Exception as error:
            status = 'FAIL'
            evidence = str(error)
            findings.append(
                finding('critical', 'MAJOR', 'CRITICAL_FLOW_FAILED', f"{flow['name']}: {error}", flow['id'])
            )
        matrix.append({'id': flow['id'], 'status': status, 'evidence': evidence})

    await context.close()
    result = save_gate('critical', findings, {'matrix': matrix})
    print(f"CRITICAL {result['status']}: {len(matrix)} workflow, {len(findings)} nálezů")
    return result['status'] != 'FAIL'


async def run_visual(browser):
    plan = load_json(ROOT / 'qa' / 'visual-plan.json')
    findings = []
    matrix = []

    for scenario in plan.get('scenarios', []):
        viewports = scenario.get('viewports', [])
        if not viewports:
            continue
        first = viewports[0]
        context = await browser.new_context(
            viewport={'width': first['width'], 'height': first['height']},
            reduced_motion='reduce',
            service_workers='block',
        )
        page = await context.new_page()
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.on('pageerror', lambda err: errors.append(str(err)))
        await page.route('**/*', fulfill_route)

        await set_document(page, scenario['url'])
        await run_steps(page, scenario.get('steps'))

        for index, viewport in enumerate(viewports):
            width, height = viewport['width'], viewport['height']
            if index > 0:
                await page.set_viewport_size({'width': width, 'height': height})
                await page.wait_for_timeout(250)

            status = 'PASS'
            message = 'Bez zjištěné vady.'
            screenshot_name = f"{scenario['id']}-{width}x{height}.png"
            screenshot_path = SCREEN_DIR / screenshot_name
            try:
                body = await page.text_content('body') or ''
                if scenario.get('expectedText') not in body:
                    raise AssertionError(f"Chybí text: {scenario.get('expectedText')}")
                for selector in scenario.get('mustVisible', []):
                    locator = page.locator(selector)
                    if not await locator.count() or not await locator.first.is_visible():
                        raise AssertionError(f"Není viditelné: {selector}")
                metrics = await page.evaluate('''() => ({
                  scrollWidth: document.documentElement.scrollWidth,
                  clientWidth: document.documentElement.clientWidth,
                  bodyText: (document.body.innerText || '').trim().length,
                  access: document.documentElement.dataset.ghrabAccess || ''
                })''')
                if metrics['scrollWidth'] > metrics['clientWidth'] + 2:
                    raise AssertionError(f"Horizontální přetečení {metrics['scrollWidth']} > {metrics['clientWidth']}")
                if metrics['bodyText'] < 30:
                    raise AssertionError('Stránka je obsahově prázdná.')
                if metrics['access'] != 'granted':
                    raise AssertionError(f"Přístupový stav: {metrics['access']}")
                local_errors = [e for e in errors if '404' in e or 'Failed to load resource' in e or 'Uncaught' in e]
                if local_errors:
                    raise AssertionError('Konzolové chyby: ' + ' | '.join(local_errors))
            except Exception as error:
                status = 'FAIL'
                message = str(error)
                findings.append(
                    finding(
                        'visual',
                        'MAJOR',
                        'VISUAL_SCENARIO_FAILED',
                        f"{scenario['name']} {width}x{height}: {message}",
                        screenshot_name,
                    )
                )

            await page.screenshot(
                path=str(screenshot_path),
                full_page=True,
                animations='disabled',
                timeout=15000,
            )
            matrix.append({
                'scenario': scenario['id'],
                'viewport': f'{width}x{height}',
                'status': status,
                'message': message,
                'screenshot': f'qa-screenshots/{screenshot_name}',
            })

        await context.close()

    result = save_gate('visual', findings, {'matrix': matrix, 'screenshots': len(matrix)})
    print(f"VISUAL {result['status']}: {len(matrix)} snímků, {len(findings)} nálezů")
    return result['status'] != 'FAIL'


async def main():
    executable = os.environ.get('GHRAB_CHROMIUM_PATH') or '/usr/bin/chromium'
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=True,
        executable_path=executable if Path(executable).exists() else None,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
    )
    try:
        critical_ok = await run_critical(browser)
        visual_ok = await run_visual(browser)
        return 0 if critical_ok and visual_ok else 1
    finally:
        try:
            await asyncio.wait_for(browser.close(), timeout=5)
        except Exception:
            pass
        try:
            await asyncio.wait_for(playwright.stop(), timeout=5)
        except Exception:
            pass


raise SystemExit(asyncio.run(main()))
