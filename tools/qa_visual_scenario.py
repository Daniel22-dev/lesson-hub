import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

from qa_browser_common import ROOT, SCREEN_DIR, load_json, fulfill_route, set_document, run_steps


async def main():
    if len(sys.argv) != 3:
        raise SystemExit('Použití: qa_visual_scenario.py SCENARIO_ID OUTPUT_JSON')
    scenario_id, output = sys.argv[1], Path(sys.argv[2])
    plan = load_json(ROOT / 'qa' / 'visual-plan.json')
    scenario = next((item for item in plan.get('scenarios', []) if item.get('id') == scenario_id), None)
    if not scenario:
        raise SystemExit(f'Neznámý scénář: {scenario_id}')

    executable = os.environ.get('GHRAB_CHROMIUM_PATH') or '/usr/bin/chromium'
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=True,
        executable_path=executable if Path(executable).exists() else None,
        args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
    )
    first = scenario['viewports'][0]
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
    matrix = []
    try:
        await set_document(page, scenario['url'])
        await run_steps(page, scenario.get('steps'))
        for index, viewport in enumerate(scenario['viewports']):
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
                expected = scenario.get('expectedText')
                if expected and expected not in body:
                    raise AssertionError(f'Chybí text: {expected}')
                for selector in scenario.get('mustVisible', []):
                    locator = page.locator(selector)
                    if not await locator.count() or not await locator.first.is_visible():
                        raise AssertionError(f'Není viditelné: {selector}')
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
            await page.screenshot(path=str(screenshot_path), full_page=True, animations='disabled', timeout=15000)
            matrix.append({
                'scenario': scenario['id'],
                'name': scenario.get('name', scenario['id']),
                'viewport': f'{width}x{height}',
                'status': status,
                'message': message,
                'screenshot': f'qa-screenshots/{screenshot_name}',
            })
    except Exception as error:
        matrix.append({
            'scenario': scenario['id'], 'name': scenario.get('name', scenario['id']),
            'viewport': 'setup', 'status': 'FAIL', 'message': str(error), 'screenshot': ''
        })
    finally:
        # Výsledek zapisujeme před ukončováním Chromia. Některá kontejnerová
        # prostředí mohou uváznout při zavírání browser procesu, ale hotový
        # scénář a jeho důkazní snímky se tím nesmějí ztratit.
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'scenario': scenario_id, 'matrix': matrix}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for target in (context, browser):
            try:
                await asyncio.wait_for(target.close(), timeout=5)
            except Exception:
                pass
        try:
            await asyncio.wait_for(playwright.stop(), timeout=5)
        except Exception:
            pass
    return 0 if all(item['status'] == 'PASS' for item in matrix) else 1


raise SystemExit(asyncio.run(main()))
