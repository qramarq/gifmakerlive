// Static studio under a subpath. No conversion backend and no COOP/COEP headers.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch(process.env.GIFMAKER_TEST_BROWSER
    ? {executablePath: process.env.GIFMAKER_TEST_BROWSER, headless: true, args: ['--enable-unsafe-swiftshader']}
    : {channel: 'msedge', headless: true});
  const context = await browser.newContext({viewport: {width: 1360, height: 900}, serviceWorkers: 'allow'});
  const page = await context.newPage();
  const errors = [];
  const api = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE', msg.text()); });
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/(convert|animate|download)(\/|$)/.test(path)) api.push(path);
  });
  try {
    const base = process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8776/technologies/gifmakerlive/';
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#advanced').open || document.querySelector('h1'));
    assert.equal(await page.locator('script[type=module]').getAttribute('src'), 'studio.js');
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), 'manifest.webmanifest');
    const manifest = await page.evaluate(async () => {
      const response = await fetch(document.querySelector('link[rel="manifest"]').href);
      return {type: response.headers.get('content-type'), body: await response.json(), finalUrl: response.url};
    });
    assert.match(manifest.type || '', /manifest\+json|application\/json|text\/plain|application\/octet-stream/);
    assert.equal(manifest.body.start_url, './');
    assert.equal(manifest.body.scope, './');
    assert.equal(manifest.body.display, 'standalone');
    assert.equal(manifest.body.name, 'GIF Maker Live');
    assert.equal(manifest.body.background_color, '#141717');
    assert.ok(manifest.body.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any' && !icon.src.startsWith('/')));
    assert.ok(manifest.body.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'));
    assert.ok(manifest.body.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'maskable'));
    assert.ok(manifest.body.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
    for (const icon of manifest.body.icons) {
      const response = await page.request.get(new URL(icon.src, manifest.finalUrl).href);
      assert.equal(response.status(), 200, icon.src);
      assert.ok((await response.body()).byteLength > 32);
    }
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, {timeout: 20000});
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    assert.equal(scope, new URL('./', page.url()).href);
    assert.ok(scope.endsWith('/technologies/gifmakerlive/') || scope === new URL('./', base).href);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]);
      return {names, urls: (await cache.keys()).map(request => request.url)};
    });
    assert.equal(cached.names.length, 1);
    assert.match(cached.names[0], /^gifmaker-live-/);
    assert.ok(cached.urls.some(url => url.endsWith('/studio.js')));
    assert.ok(cached.urls.every(url => url.startsWith(scope)));
    await context.setOffline(true);
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('h1').waitFor();
    assert.match(await page.locator('h1').innerText(), /A little motion/);
    await page.locator('#animate-toggle').check();
    assert.equal(await page.locator('#motion-panel').isVisible(), true);
    assert.equal(await page.locator('#file').count(), 1);
    await page.locator('#animate-toggle').uncheck();
    assert.equal(await page.locator('#camera-tab').isVisible(), true);
    assert.equal(await page.locator('#convert').isVisible(), true);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
    console.log('PASS: relative manifest and service worker, subpath scope, offline studio, no API calls');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
