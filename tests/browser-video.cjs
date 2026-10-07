// Run against the real local backend; uses the same browser as the motion CI check.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-browser-'));
  const fixture = path.join(temp, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x200:rate=10', '-t', '6', '-pix_fmt', 'yuv420p', fixture]);
  const browser = await chromium.launch(process.env.GIFMAKER_TEST_BROWSER
    ? {executablePath: process.env.GIFMAKER_TEST_BROWSER, headless: true}
    : {channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1360, height: 1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/wasm/**', route => route.abort());
    await page.goto(process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8782');
    await page.waitForFunction(() => document.querySelector('#advanced').open);
    await page.locator('#file').setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelector('#video').duration === 6);
    assert.match(await page.locator('#edit-summary').innerText(), /5.00 \/ 5/);
    const times = page.locator('#segments input');
    await times.nth(1).fill('2');
    await page.locator('#add-segment').click();
    await times.nth(2).fill('3');
    await times.nth(3).fill('6');
    await page.locator('[data-crop]').nth(2).fill('50');
    await page.locator('#preview-edit').click();
    await page.waitForFunction(() => document.querySelector('#video').currentTime > .1);
    await page.waitForFunction(() => document.querySelector('#video').currentTime >= 3, null, {timeout: 8000});
    await page.locator('#video').evaluate(video => video.pause());
    const request = page.waitForRequest(request => request.url().endsWith('/convert'));
    await page.locator('#convert').click();
    assert.match((await request).postData(), /"segments":\[\[0,2\],\[3,6\]\]/);
    await page.locator('#download').waitFor({state: 'visible', timeout: 120000});
    const dimensions = await page.locator('#gif').evaluate(image => ({width: image.naturalWidth, height: image.naturalHeight}));
    assert.deepEqual(dimensions, {width: 320, height: 400});
    await times.nth(1).fill('3');
    assert.equal(await page.locator('#download').isVisible(), false);
    await page.locator('#convert').click();
    assert.match(await page.locator('#status').innerText(), /within 5 seconds/);
    await page.locator('#reset-edit').click();
    assert.equal(await times.count(), 2);
    assert.equal(await page.locator('[data-crop]').nth(2).inputValue(), '100');
    await page.screenshot({path: process.env.GIFMAKER_VIDEO_SCREENSHOT || path.join(temp, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path: process.env.GIFMAKER_VIDEO_MOBILE_SCREENSHOT || path.join(temp, 'mobile.png'), fullPage: true});
    await page.locator('#animate-toggle').check();
    assert.equal(await page.locator('#video-editor').isVisible(), false);
    await page.locator('#animate-toggle').uncheck();
    await page.locator('#file').setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelector('#video').duration === 6);
    assert.equal(await times.count(), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: upload, splice preview, cropped GIF download, invalid edits, reset, mode switch, and mobile layout');
  } finally {
    await browser.close();
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
