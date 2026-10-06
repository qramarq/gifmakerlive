// Run against a local app with built Wasm: NODE_PATH=<playwright location>
// GIFMAKER_TEST_VIDEO=<short mp4> node tests/browser.cjs
// Set GIFMAKER_TEST_GPU_FALLBACK=1 to exercise the HTML controls without Wasm.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

async function assertContinuousLoop(page) {
  assert.match(await page.locator('#loop-gif').innerText(), /Loop GIF[\s\S]*Enabled/);
  const bytes = await page.locator('#download').evaluate(async link =>
    Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer())));
  assert.ok(Buffer.from(bytes).includes(Buffer.from('\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00', 'latin1')),
    'The downloaded GIF must contain an infinite loop count');
}

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
    const fallback = process.env.GIFMAKER_TEST_GPU_FALLBACK === '1';
    if (fallback) await page.route('**/wasm/**', route => route.abort());
    await page.goto(process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8765');
    assert.equal(await page.locator('#loop-gif').isVisible(), true);
    if (fallback) {
      await page.waitForFunction(() => document.getElementById('advanced').open);
      await page.locator('#fps').fill('15');
    } else {
      await page.frameLocator('#settings').locator('#loading').waitFor({ state: 'detached', timeout: 90000 });
      await page.frameLocator('#settings').locator('canvas').waitFor();
      // GPUI uses a canvas; the preset's point is relative to the fixed-width panel.
      const box = await page.locator('#settings').boundingBox();
      // Canvas creation precedes the asynchronous GPU pipeline's first paint.
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.mouse.click(box.x + 180, box.y + 222);
        try {
          await page.waitForFunction(() => document.getElementById('fps').value === '15', null, {timeout: 1000});
          break;
        } catch (error) { if (attempt === 9) throw error; }
      }
    }
    await page.waitForFunction(() => document.getElementById('fps').value === '15', null, {timeout: 10000});
    await page.locator('#file').setInputFiles(process.env.GIFMAKER_TEST_VIDEO);
    await page.locator('#convert').click();
    await page.locator('#download').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('#status').innerText(), /Loop ready/);
    await assertContinuousLoop(page);
    await page.locator('#camera-tab').click();
    await page.locator('#record').waitFor({ state: 'visible' });
    await page.locator('#record').click();
    await page.waitForTimeout(1200); // Record enough frames for the encoder.
    await page.locator('#record').click();
    await page.waitForFunction(() => !document.getElementById('convert').disabled, null, {timeout: 10000});
    await page.locator('#convert').click();
    await page.locator('#download').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.locator('#status').innerText(), /Loop ready/);
    await assertContinuousLoop(page);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${fallback ? 'HTML fallback controls' : 'GPUI preset'}, continuously looping upload and synthetic camera GIF downloads, mobile layout`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
