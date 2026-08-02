import asyncio
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1] / 'dist'

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

async def render_main(page, hash_route):
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    html = html.replace('<head>', '<head><base href="https://lesson-hub.test/">', 1)
    await page.set_content(html, wait_until='load', timeout=20000)
    await page.wait_for_timeout(700)
    if hash_route:
        await page.evaluate(f"location.hash={hash_route!r}")
        await page.wait_for_timeout(500)

async def render_manual(page):
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
            page = await browser.new_page(viewport={'width': 1366, 'height': 768})
            errors = []
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.on('pageerror', lambda err: errors.append(str(err)))
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
            await page.close()
        await browser.close()
    return 1 if failed else 0

raise SystemExit(asyncio.run(main()))
