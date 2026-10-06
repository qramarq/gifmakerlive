// Run against a local app with built Wasm: NODE_PATH=<playwright location>
// GIFMAKER_TEST_VIDEO=<short mp4> node tests/browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  assert.ok(process.env.GIFMAKER_TEST_VIDEO, 'Set GIFMAKER_TEST_VIDEO to a short MP4 fixture');
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8765');
    await page.frameLocator('#settings').locator('#loading').waitFor({ state: 'detached', timeout: 90000 });
    await page.frameLocator('#settings').locator('canvas').waitFor();
    // GPUI uses a canvas; the preset's point is relative to the fixed-width panel.
    const box = await page.locator('#settings').boundingBox();
    await page.mouse.click(box.x + 180, box.y + 222);
    await page.waitForFunction(() => document.getElementById('fps').value === '15');
    await page.locator('#file').setInputFiles(process.env.GIFMAKER_TEST_VIDEO);
    await page.locator('#convert').click();
    await page.locator('#download').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('#status').innerText(), /Loop ready/);
    await page.locator('#camera-tab').click();
    await page.locator('#record').waitFor({ state: 'visible' });
    await page.locator('#record').click();
    await page.waitForTimeout(1200); // Record enough frames for the encoder.
    await page.locator('#record').click();
    await page.waitForFunction(() => !document.getElementById('convert').disabled);
    await page.locator('#convert').click();
    await page.locator('#download').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('#status').innerText(), /Loop ready/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: GPUI preset, upload conversion, synthetic camera conversion, mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
