import asyncio
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1] / 'dist'
BASE_URL = os.environ.get('LESSON_HUB_BASE_URL', '').rstrip('/')

async def serve_route(request_route):
    url = urlparse(request_route.request.url)
    if url.hostname == 'lesson-hub.test':
        relative = url.path.lstrip('/') or 'index.html'
        target = (ROOT / relative).resolve()
        if target.is_dir():
            target = target / 'index.html'
        if ROOT not in target.parents and target != ROOT:
            await request_route.fulfill(status=403, body='Forbidden')
            return
        if not target.exists():
            await request_route.fulfill(status=404, body='Not found')
            return
        content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        if target.suffix == '.webmanifest':
            content_type = 'application/manifest+json'
        await request_route.fulfill(status=200, path=str(target), content_type=content_type)
    elif url.hostname == 'daniel22-dev.github.io' and url.path.endswith('/access/access-gate.css'):
        await request_route.fulfill(status=200, body='', content_type='text/css')
    else:
        await request_route.abort()


async def serve_central_route(route):
    path = urlparse(route.request.url).path
    if path.endswith('/AI-Studio-GHRAB/access/access-gate.css'):
        await route.fulfill(status=200, body='', content_type='text/css')
    elif path.endswith('/AI-Studio-GHRAB/config/support.json'):
        await route.fulfill(status=200, body='{"supportEmail":"balaz@ghrabuvka.cz"}', content_type='application/json')
    elif path.endswith('/AI-Studio-GHRAB/config/apps.generated.json'):
        await route.fulfill(status=200, body='[{"id":"lesson-hub","version":"1.2.15","name":{"cs":"Lesson Hub","en":"Lesson Hub"}}]', content_type='application/json')
    else:
        await route.continue_()

async def wait_for_main_ready(page, hash_route, timeout=20000):
    expected_route = str(hash_route or '#/overview').replace('#/', '', 1).replace('#', '', 1) or 'overview'
    await page.wait_for_function(
        """expectedRoute => {
          const app = document.querySelector('#app');
          return Boolean(
            document.documentElement.dataset.ghrabAccess === 'granted' &&
            app &&
            !app.hasAttribute('aria-busy') &&
            app.dataset.renderedRoute === expectedRoute &&
            getComputedStyle(document.body).visibility !== 'hidden'
          );
        }""",
        arg=expected_route,
        timeout=timeout,
    )


async def render_main(page, hash_route):
    if BASE_URL:
        target = f"{BASE_URL}/index.html?qa=1{hash_route or '#/overview'}"
        await page.goto(target, wait_until='networkidle', timeout=20000)
    else:
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        html = html.replace('<head>', '<head><base href="https://lesson-hub.test/">', 1)
        await page.set_content(html, wait_until='load', timeout=20000)
        await page.wait_for_timeout(100)
        if hash_route and await page.evaluate("location.hash") != hash_route:
            await page.evaluate("hashRoute => { location.hash = hashRoute; }", arg=hash_route)
    await wait_for_main_ready(page, hash_route)

async def render_manual(page):
    if BASE_URL:
        await page.goto(f"{BASE_URL}/manual/index.html", wait_until='networkidle', timeout=20000)
    else:
        html = (ROOT / 'manual' / 'index.html').read_text(encoding='utf-8')
        html = html.replace('<head>', '<head><base href="https://lesson-hub.test/manual/">', 1)
        await page.set_content(html, wait_until='load', timeout=20000)
    await page.wait_for_timeout(700)

async def main():
    scenarios = [
        ('overview', 'Připravte Lesson Hub na svou výuku', '#/overview'),
        ('groups', 'Skupiny', '#/groups'),
        ('diagnostics', 'Interní diagnostika Lesson Hubu', '#/diagnostics'),
        ('data', 'Úplný export databáze', '#/data'),
        ('manual', 'Interaktivní manuál', None),
    ]
    executable = os.environ.get('CHROMIUM_PATH') or '/usr/bin/chromium'
    failed = False
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path=executable if Path(executable).exists() else None,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
        )
        for name, expected, hash_route in scenarios:
            context = await browser.new_context(viewport={'width': 1366, 'height': 768}, service_workers='block')
            page = await context.new_page()
            errors = []
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.on('response', lambda response: errors.append(f'HTTP {response.status} {response.url}') if response.status >= 400 else None)
            if BASE_URL:
                await page.route('**/*', serve_central_route)
            else:
                await page.route('**/*', serve_route)
            if name == 'manual':
                await render_manual(page)
            else:
                await render_main(page, hash_route)
            body = await page.text_content('body') or ''
            access = await page.evaluate("document.documentElement.dataset.ghrabAccess || ''")
            local_404 = [e for e in errors if '404' in e or 'Failed to load resource' in e]
            ok = expected in body and access == 'granted' and not local_404
            if ok:
                print(f'PASS {name}')
            else:
                failed = True
                print(f'FAIL {name}: expected={expected in body} access={access} errors={errors}', file=sys.stderr)
            await context.close()
        await browser.close()
    return 1 if failed else 0

raise SystemExit(asyncio.run(main()))
