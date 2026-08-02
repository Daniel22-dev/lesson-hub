import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
QA_RESULTS = ROOT / 'qa-results'
SCREEN_DIR = QA_RESULTS / 'qa-screenshots'
DIFF_DIR = QA_RESULTS / 'qa-differences'
LOG_DIR = QA_RESULTS / 'qa-logs'
STATE_FILE = QA_RESULTS / '.qa-state.json'

for directory in (QA_RESULTS, SCREEN_DIR, DIFF_DIR, LOG_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def load_state():
    if not STATE_FILE.exists():
        return {'gates': {}, 'commands': []}
    return load_json(STATE_FILE)


def save_gate(name, findings, details):
    blockers = sum(1 for item in findings if item['severity'] == 'BLOCKER')
    majors = sum(1 for item in findings if item['severity'] == 'MAJOR')
    minors = sum(1 for item in findings if item['severity'] == 'MINOR')
    status = 'FAIL' if blockers or majors else ('WARN' if minors else 'PASS')
    result = {'name': name, 'status': status, 'findings': findings, 'details': details}
    state = load_state()
    state.setdefault('gates', {})[name] = result
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (QA_RESULTS / f'{name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


def finding(gate, severity, code, message, evidence=''):
    return {'gate': gate, 'severity': severity, 'code': code, 'message': message, 'evidence': evidence}


async def fulfill_route(route):
    url = urlparse(route.request.url)
    if url.hostname == 'lesson-hub.test':
        relative = url.path.lstrip('/') or 'index.html'
        target = (DIST / relative).resolve()
        if target.is_dir():
            target = target / 'index.html'
        if DIST not in target.parents and target != DIST:
            await route.fulfill(status=403, body='Forbidden')
            return
        if not target.exists():
            await route.fulfill(status=404, body='Not found')
            return
        content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        if target.suffix == '.webmanifest':
            content_type = 'application/manifest+json'
        await route.fulfill(status=200, path=str(target), content_type=content_type)
        return
    if url.hostname == 'daniel22-dev.github.io' and url.path.endswith('/access/access-gate.css'):
        await route.fulfill(status=200, body='', content_type='text/css')
        return
    await route.abort()


async def set_document(page, url):
    parsed = urlparse(url)
    path = parsed.path.lstrip('/') or 'index.html'
    target = DIST / path
    if target.is_dir():
        target = target / 'index.html'
    html = target.read_text(encoding='utf-8')
    base_path = '/' + str(Path(path).parent).replace('\\', '/').strip('/')
    if base_path == '/.':
        base_path = ''
    base_href = f'https://lesson-hub.test{base_path}/'
    html = re.sub(r'<head([^>]*)>', rf'<head\1><base href="{base_href}">', html, count=1, flags=re.I)
    await page.set_content(html, wait_until='load', timeout=20000)
    await page.wait_for_timeout(650)
    if parsed.fragment:
        await page.evaluate('(hash) => { location.hash = hash; }', '#' + parsed.fragment)
        await page.wait_for_timeout(350)


async def wait_for_app_idle(page, timeout=10000):
    await page.wait_for_timeout(100)
    if not await page.locator('#app').count():
        return
    await page.wait_for_function(
        """() => {
          const app = document.querySelector('#app');
          const content = document.querySelector('#page-content');
          const bodyVisible = getComputedStyle(document.body).visibility !== 'hidden';
          return Boolean(app && content && bodyVisible && !app.hasAttribute('aria-busy'));
        }""",
        timeout=timeout,
    )


async def resolve_step_value(page, value):
    if value != '__TODAY__':
        return '' if value is None else str(value)
    return await page.evaluate("""() => {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    }""")


async def run_steps(page, steps):
    for step in steps or []:
        action = step.get('action')
        if action == 'wait':
            await page.wait_for_timeout(int(step.get('ms', 250)))
        elif action == 'click':
            await page.locator(step['selector']).first.click(timeout=int(step.get('timeout', 5000)))
        elif action == 'clickIfVisible':
            locator = page.locator(step['selector'])
            if await locator.count() and await locator.first.is_visible():
                await locator.first.click(timeout=int(step.get('timeout', 5000)))
        elif action == 'fill':
            await page.locator(step['selector']).first.fill(await resolve_step_value(page, step.get('value')), timeout=int(step.get('timeout', 5000)))
        elif action == 'select':
            await page.locator(step['selector']).first.select_option(str(step.get('value', '')), timeout=int(step.get('timeout', 5000)))
        elif action == 'press':
            await page.keyboard.press(step.get('key', 'Enter'))
        elif action == 'evaluate':
            await page.evaluate(step.get('script', ''))
        if action in {'click', 'clickIfVisible', 'select', 'press', 'evaluate'}:
            await wait_for_app_idle(page, timeout=int(step.get('timeout', 10000)))
        if action == 'assertText':
            locator = page.locator(step.get('selector', 'body')).first
            text = await locator.inner_text()
            if str(step.get('text', '')).lower() not in text.lower():
                raise AssertionError(f"Chybí text: {step.get('text', '')}")
        if action == 'assertVisible':
            locator = page.locator(step['selector'])
            if not await locator.count() or not await locator.first.is_visible():
                raise AssertionError(f"Prvek není viditelný: {step['selector']}")
