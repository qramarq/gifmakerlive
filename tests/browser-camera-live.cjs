// Live camera dimensions, screen-orientation lock, and resolution changes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.GIFMAKER_TEST_BROWSER || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    let settings = { width: 1920, height: 1080, aspectRatio: 1920 / 1080, facingMode: 'environment', deviceId: 'live-cam' };
    const paint = () => {
      context.fillStyle = '#143014';
      context.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(paint);
    };
    paint();
    const stream = canvas.captureStream(15);
    const track = stream.getVideoTracks()[0];
    track.getSettings = () => ({ ...settings });
    track.getCapabilities = () => ({
      width: { min: 320, max: 4096 },
      height: { min: 240, max: 2160 },
      aspectRatio: { min: 0.4, max: 2.5 },
      facingMode: ['environment'],
    });
    const nativeApply = track.applyConstraints?.bind(track);
    track.applyConstraints = async constraints => {
      const width = constraints.width?.ideal || constraints.width;
      const height = constraints.height?.ideal || constraints.height;
      settings = { ...settings, width, height, aspectRatio: width / height };
      canvas.width = width;
      canvas.height = height;
      try { await nativeApply?.(constraints); } catch { /* The canvas stream may reject a size it does not advertise. */ }
    };
    window.__setCameraSize = (width, height) => {
      settings = { ...settings, width, height, aspectRatio: width / height };
      canvas.width = width;
      canvas.height = height;
    };
    navigator.mediaDevices.getUserMedia = async () => stream;
  });
  try {
    await page.goto(process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8776/');
    await page.evaluate(() => {
      const frame = document.querySelector('#settings');
      const send = frame.contentWindow.postMessage.bind(frame.contentWindow);
      frame.contentWindow.postMessage = (data, origin) => {
        if (data?.type === 'gif-host-settings') window.__gifSettings = data;
        return send(data, origin);
      };
    });
    await page.locator('#camera-tab').click();
    await page.locator('#record').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#live-camera-tools').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#height').value === '180');
    assert.match(await page.locator('#camera-readout').innerText(), /320×180/);
    assert.match(await page.locator('#camera-readout').innerText(), /16:9/);

    await page.evaluate(() => window.__setCameraSize(1080, 1920));
    await page.waitForFunction(() => document.querySelector('#height').value === '569');
    assert.match(await page.locator('#camera-readout').innerText(), /9:16/);
    await page.waitForFunction(() => window.__gifSettings?.height === 569 && /320×569/.test(window.__gifSettings.detected));

    await page.evaluate(() => window.__setCameraSize(4096, 2160));
    await page.waitForFunction(() => document.querySelector('#height').value === '169');
    assert.match(await page.locator('#camera-readout').innerText(), /DCI 17:9/);
    assert.equal(await page.evaluate(() => window.__gifSettings.height), 169);

    await page.evaluate(() => window.__setCameraSize(1920, 1080));
    await page.waitForFunction(() => document.querySelector('#height').value === '180');
    await page.locator('#orientation-mode').selectOption('portrait');
    await page.waitForFunction(() => document.querySelector('#height').value === '569');
    assert.match(await page.locator('#camera-readout').innerText(), /Locked portrait/);
    await page.evaluate(() => window.__setCameraSize(1080, 1920));
    await page.waitForFunction(() => document.querySelector('#height').value === '569');
    await page.locator('#orientation-mode').selectOption('landscape');
    await page.waitForFunction(() => document.querySelector('#height').value === '180');
    assert.match(await page.locator('#camera-readout').innerText(), /Locked landscape/);
    await page.locator('#orientation-mode').selectOption('');
    await page.waitForFunction(() => document.querySelector('#height').value === '569');
    assert.doesNotMatch(await page.locator('#camera-readout').innerText(), /Locked/);

    await page.locator('#camera-resolution').selectOption('1280x720');
    await page.waitForFunction(() => document.querySelector('#height').value === '180');
    assert.match(await page.locator('#camera-readout').innerText(), /16:9/);
    assert.equal(await page.evaluate(() => window.__gifSettings.height), 180);
    assert.deepEqual(errors, []);
    console.log('PASS: live rotation, DCI resize, orientation lock, and resolution change update GIF output');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
