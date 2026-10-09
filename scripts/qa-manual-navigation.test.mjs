import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const scriptPath = process.env.MANUAL_NAV_JS;
assert.ok(scriptPath, 'MANUAL_NAV_JS must identify the checked-in manual navigation script');
const source = readFileSync(scriptPath, 'utf8');
const style = readFileSync(scriptPath.replace(/\.js$/, '.css'), 'utf8');

function element(tag = 'div', text = '') {
  return {
    tagName: tag.toUpperCase(), textContent: text, hidden: false, style: {},
    children: [], attributes: {}, classList: { add() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    closest() { return this; },
    querySelector() { return null; },
  };
}
function simulate(search = '', { embedded = false, permit = 'granted', referrer = '' } = {}) {
  const location = new URL(`https://daniel22-dev.github.io/demo/manual/${search}`);
  const header = element('header');
  const legacyApp = element('a', 'Zpět do aplikace');
  const legacyStudio = element('a', 'AI Studio');
  const print = element('button', 'Vytisknout');
  const documentElement = { dataset: { ghrabAccess: permit } };
  const document = {
    documentElement, referrer,
    querySelector() { return header; },
    querySelectorAll(selector) { return selector === 'header a' ? [legacyApp, legacyStudio] : [print]; },
    getElementById(id) { return header.children.find(node => node.id === id) || null; },
    createElement: element,
  };
  const window = {
    frameElement: embedded ? { id: 'manual-frame' } : null,
    __GHRAB_DEPLOYMENT_CONFIG__: { studioBaseUrl: '/AI-Studio-GHRAB/' }, location,
  };
  window.parent = embedded ? { location: { pathname: '/AI-Studio-GHRAB/manualy/viewer.html' } } : window;
  let observeCallback = null;
  class MutationObserver {
    constructor(callback) { observeCallback = callback; }
    observe() {}
    disconnect() {}
  }
  runInNewContext(source, { URL, URLSearchParams, window, location, document, MutationObserver }, { timeout: 2000 });
  return {
    header, documentElement, legacyApp, legacyStudio, print,
    get links() { return (document.getElementById('ghrab-manual-navigation')?.children || []).map(node => ({ text: node.textContent, href: node.href })); },
    grant() { documentElement.dataset.ghrabAccess = 'granted'; observeCallback?.(); },
  };
}
const appHome = 'https://daniel22-dev.github.io/demo/';
const studioHome = 'https://daniel22-dev.github.io/AI-Studio-GHRAB/';

test('app launch returns to application and Studio without legacy links', () => {
  const x = simulate('?from=app');
  assert.deepEqual(x.links.map(link => link.text), ['← Zpět do aplikace', 'AI Studio']);
  assert.equal(x.links[0].href, appHome);
  assert.equal(x.links[1].href, studioHome);
  assert.ok(x.legacyApp.hidden && x.legacyStudio.hidden && x.print.hidden);
});
test('catalog launch returns only to manuals and Studio', () => {
  const x = simulate('?from=studio');
  assert.deepEqual(x.links.map(link => link.text), ['← Zpět na manuály', 'AI Studio']);
  assert.equal(x.links[0].href, studioHome + 'manualy/');
});
test('direct link cannot be tricked into an arbitrary URL', () => {
  for (const query of ['', '?return=https%3A%2F%2Fevil.example%2F', '?from=unknown']) {
    const x = simulate(query);
    assert.deepEqual(x.links.map(link => link.text), ['AI Studio']);
    assert.equal(x.links[0].href, studioHome);
  }
});
test('untrusted referrer is ignored', () => {
  const x = simulate('', { referrer: 'https://evil.example/manualy/' });
  assert.deepEqual(x.links.map(link => link.text), ['AI Studio']);
});
test('embedded Studio viewer has no local return links or print buttons', () => {
  const x = simulate('?from=studio', { embedded: true });
  assert.equal(x.links.length, 0);
  assert.equal(x.documentElement.dataset.ghrabManualEmbedded, 'viewer');
  assert.ok(x.legacyApp.hidden && x.print.hidden);
});
test('access gate blocks UI until access grant', () => {
  const x = simulate('?from=studio', { permit: 'checking' });
  assert.equal(x.links.length, 0);
  x.grant();
  assert.deepEqual(x.links.map(link => link.text), ['← Zpět na manuály', 'AI Studio']);
  x.grant();
  assert.equal(x.header.children.length, 1);
});
test('dark/light contrast and focus styles exist', () => {
  assert.match(style, /\.ghrab-manual-navigation\s+a/);
  assert.match(style, /color\s*:\s*var\(--text/);
  assert.match(style, /:focus-visible/);
  assert.match(style, /@media\s*\(max-width/);
});
