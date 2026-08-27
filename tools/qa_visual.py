import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright
from qa_browser_common import ROOT, SCREEN_DIR, load_json, finding, save_gate, fulfill_route, set_document, run_steps


async def main():
    plan = load_json(ROOT / 'qa' / 'visual-plan.json')
    findings = []
    matrix = []
    executable = os.environ.get('GHRAB_CHROMIUM_PATH') or '/usr/bin/chromium'
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=True,
        executable_path=executable if Path(executable).exists() else None,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
    )
    try:
        # Jeden izolovaný kontext pro každý scénář. Moduly se tak načtou znovu
        # mezi trasami, ale změny viewportu stejné obrazovky jsou rychlé.
        for scenario in plan.get('scenarios', []):
            viewports = scenario.get('viewports', [])
            if not viewports:
                continue

            first = viewports[0]
            context = await browser.new_context(
                viewport={'width': first['width'], 'height': first['height']},
                reduced_motion='reduce',
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
        return 1 if result['status'] == 'FAIL' else 0
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
