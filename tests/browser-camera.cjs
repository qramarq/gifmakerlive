// Camera enumeration, hot-plug, constraint fallback, resize, and GIF capture.
// GIFMAKER_TEST_URL=http://127.0.0.1:8791/?camera=mock node tests/browser-camera.cjs
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const MOCK = `
(() => {
  const mode = new URLSearchParams(location.search).get('camera') || '';
  if (!mode || location.pathname.endsWith('/settings.html')) return;
  const media = navigator.mediaDevices;
  if (!media) return;
  window.__cameraMock = mode;
  window.__cameraCalls = [];
  window.__tracks = [];
  let permitted = false;
  let permit = mode !== 'mock';
  let releasePermit = () => {};
  const permitPromise = new Promise(resolve => { releasePermit = resolve; });
  window.__releaseCamera = () => { permit = true; releasePermit(); };
  const devices = [
    {kind: 'videoinput', deviceId: 'cam-builtin', label: 'Built-in Webcam', groupId: 'g1'},
    {kind: 'videoinput', deviceId: 'cam-capture', label: 'HDMI Capture Card', groupId: 'g2'},
    {kind: 'videoinput', deviceId: 'cam-obs', label: 'OBS Virtual Camera', groupId: 'g3'},
  ];
  window.__addCamera = device => {
    devices.push(device);
    media.dispatchEvent(new Event('devicechange'));
  };
  media.enumerateDevices = async () => permitted
    ? devices.map(device => ({...device}))
    : [{kind: 'videoinput', deviceId: '', label: '', groupId: 'pending'}];
  function makeStream(deviceId) {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c2f970';
    context.fillRect(0, 0, 80, 60);
    const stream = canvas.captureStream(8);
    const track = stream.getVideoTracks()[0];
    const native = track.getSettings.bind(track);
    track.getSettings = () => ({...native(), deviceId, width: 80, height: 60, frameRate: 8});
    window.__canvases = window.__canvases || [];
    window.__canvases.push(canvas);
    window.__tracks.push(track);
    return stream;
  }
  function outcome(video) {
    if (video === true || video == null) return 'ok';
    const exact = video.deviceId && typeof video.deviceId === 'object' && video.deviceId.exact;
    const plain = typeof video.deviceId === 'string' && video.deviceId;
    const ideal = video.width || video.height || video.frameRate;
    const facingObject = video.facingMode && typeof video.facingMode === 'object';
    const facing = video.facingMode === 'user' || video.facingMode === 'environment';
    if (exact && ideal) return 'OverconstrainedError';
    if (exact) return 'NotReadableError';
    if (plain) return 'ok:' + video.deviceId;
    if (facingObject || (ideal && !facing)) return 'OverconstrainedError';
    if (facing) return 'ok:' + (video.facingMode === 'user' ? 'cam-user' : 'cam-env');
    return 'ok';
  }
  media.getUserMedia = async constraints => {
    window.__cameraCalls.push(JSON.parse(JSON.stringify(constraints)));
    if (mode === 'deny') throw new DOMException('denied', 'NotAllowedError');
    if (mode === 'missing') throw new DOMException('missing', 'NotFoundError');
    const result = outcome(constraints && constraints.video);
    if (result !== 'ok' && !String(result).startsWith('ok:')) throw new DOMException(result, result);
    if (!permit) await permitPromise;
    permitted = true;
    const deviceId = String(result).startsWith('ok:') ? result.slice(3) : 'cam-builtin';
    return makeStream(deviceId);
  };
})();
`;

function shape(call) {
  const video = call.video;
  if (video === true) return 'video:true';
  if (video.deviceId?.exact && video.width) return 'exact+ideal';
  if (video.deviceId?.exact) return 'exact';
  if (typeof video.deviceId === 'string') return 'deviceId';
  if (video.facingMode?.ideal) return 'facing+ideal';
  if (typeof video.facingMode === 'string') return 'facing';
  if (video.width) return 'ideal';
  return 'other';
}

async function waitFor(page, predicate, message) {
  try {
    await page.waitForFunction(predicate, null, {timeout: 10000});
  } catch (error) {
    const status = await page.locator('#status').innerText().catch(() => '');
    throw new Error(`${message}. Status: ${status}. ${error.message}`);
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.GIFMAKER_TEST_BROWSER || '/usr/bin/google-chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const context = await browser.newContext({viewport: {width: 1360, height: 1100}, permissions: ['camera']});
    await context.addInitScript(MOCK);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/wasm/**', route => route.abort());
    const base = process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8791/';
    await page.goto(new URL('?camera=mock', base).href);
    await page.waitForFunction(() => window.__cameraMock === 'mock');
    await page.locator('#camera-tab').click();
    await waitFor(page, () => [...document.querySelectorAll('#camera-device option')].some(option => /allow access/.test(option.textContent)), 'unlabeled camera');
    await page.evaluate(() => window.__releaseCamera());
    await page.locator('#record').waitFor({state: 'visible'});
    await waitFor(page, () => [...document.querySelectorAll('#camera-device option')].some(option => option.textContent === 'Built-in Webcam'), 'labeled cameras');
    await waitFor(page, () => [...document.querySelectorAll('#camera-device option')].some(option => option.textContent === 'HDMI Capture Card'), 'capture card');
    await waitFor(page, () => [...document.querySelectorAll('#camera-device option')].some(option => option.textContent === 'OBS Virtual Camera'), 'virtual camera');
    const firstShapes = await page.evaluate(() => window.__cameraCalls.map(call => {
      const video = call.video;
      if (video === true) return 'video:true';
      if (video.deviceId?.exact && video.width) return 'exact+ideal';
      if (video.width) return 'ideal';
      return 'other';
    }));
    assert.deepEqual(firstShapes, ['ideal', 'video:true']);
    assert.match(await page.locator('#filename').innerText(), /30-second limit/);
    assert.match(await page.locator('#status').innerText(), /Camera is ready/);

    const beforeSwitch = await page.evaluate(() => window.__cameraCalls.length);
    await page.evaluate(() => {
      const select = document.querySelector('#camera-device');
      select.value = 'cam-capture';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await waitFor(page, () => document.querySelector('#camera-device').value === 'cam-capture' && !document.querySelector('#record').hidden, 'capture card selected');
    const switched = await page.evaluate(start => window.__cameraCalls.slice(start), beforeSwitch);
    assert.deepEqual(switched.map(shape), ['exact+ideal', 'exact', 'deviceId']);
    assert.ok(switched.every(call => call.audio === false));
    assert.equal(await page.evaluate(() => window.__tracks[0].readyState), 'ended');

    await page.evaluate(() => window.__addCamera({kind: 'videoinput', deviceId: 'cam-scope', label: 'Lab Microscope', groupId: 'g4'}));
    await waitFor(page, () => [...document.querySelectorAll('#camera-device option')].some(option => option.textContent === 'Lab Microscope'), 'hot plug');
    assert.equal(await page.locator('#camera-device').inputValue(), 'cam-capture');

    await page.evaluate(() => {
      const select = document.querySelector('#camera-device');
      select.value = '';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await waitFor(page, () => {
      const front = document.querySelector('#facing-user');
      const back = document.querySelector('#facing-environment');
      return front && back && !front.hidden && !back.hidden && !front.disabled && !back.disabled;
    }, 'facing controls');
    const beforeFacing = await page.evaluate(() => window.__cameraCalls.length);
    await page.locator('#facing-user').click();
    await waitFor(page, () => document.querySelector('#facing-user').getAttribute('aria-pressed') === 'true', 'front camera');
    const facing = await page.evaluate(start => window.__cameraCalls.slice(start), beforeFacing);
    assert.deepEqual(facing.map(shape), ['facing+ideal', 'facing']);

    await page.evaluate(() => {
      const video = document.querySelector('#video');
      Object.defineProperty(video, 'videoWidth', {configurable: true, get: () => 1920});
      Object.defineProperty(video, 'videoHeight', {configurable: true, get: () => 1080});
      video.dispatchEvent(new Event('resize'));
    });
    await waitFor(page, () => document.querySelector('#filename').textContent.includes('1920×1080'), 'resized preview');
    assert.match(await page.locator('#status').innerText(), /changed size/);
    await page.evaluate(() => {
      const video = document.querySelector('#video');
      delete video.videoWidth;
      delete video.videoHeight;
      video.srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'));
    });
    await waitFor(page, () => /disconnected/.test(document.querySelector('#status').textContent), 'camera disconnect');
    assert.equal(await page.evaluate(() => window.__tracks.at(-1).readyState), 'ended');
    await page.locator('#camera-tab').click();
    await page.locator('#record').waitFor({state: 'visible'});

    await page.evaluate(() => {
      const Native = window.MediaRecorder;
      window.MediaRecorder = function MediaRecorder(stream, options) {
        window.__recorderOptions = options || null;
        return new Native(stream, options);
      };
      window.MediaRecorder.isTypeSupported = type => type === 'video/webm;codecs=vp8' || type === 'video/webm';
    });
    await page.locator('#record').click();
    await waitFor(page, () => /30 seconds/.test(document.querySelector('#status').textContent), 'media recorder');
    assert.equal(await page.evaluate(() => window.__recorderOptions.mimeType), 'video/webm;codecs=vp8');
    await page.waitForTimeout(900);
    await page.locator('#record').click();
    await waitFor(page, () => !document.querySelector('#convert').disabled, 'recorded file');
    assert.match(await page.locator('#filename').innerText(), /camera\.webm/);

    await page.locator('#camera-tab').click();
    await page.locator('#record').waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('#video').readyState >= 2 && document.querySelector('#video').videoWidth > 0);
    await page.evaluate(() => {
      window.MediaRecorder = function MediaRecorder() { throw new DOMException('exotic stream', 'NotSupportedError'); };
      window.MediaRecorder.isTypeSupported = () => false;
    });
    await page.locator('#record').click();
    await waitFor(page, () => /directly into a GIF/.test(document.querySelector('#status').textContent), 'frame capture');
    await page.waitForTimeout(700);
    await page.locator('#record').click();
    await waitFor(page, () => /captured from the live camera/.test(document.querySelector('#status').textContent), 'direct gif');
    const gif = Buffer.from(await page.locator('#download').evaluate(async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))));
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
    assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')));
    assert.equal(await page.evaluate(() => window.__tracks.at(-1).readyState), 'ended');

    const deny = await context.newPage();
    const denyErrors = [];
    deny.on('pageerror', error => denyErrors.push(String(error)));
    await deny.goto(new URL('?camera=deny', base).href);
    await deny.locator('#camera-tab').click();
    await waitFor(deny, () => /permission was denied/i.test(document.querySelector('#status').textContent), 'permission denied');
    assert.equal(await deny.evaluate(() => window.__cameraCalls.length), 1);

    const missing = await context.newPage();
    await missing.goto(new URL('?camera=missing', base).href);
    await missing.locator('#camera-tab').click();
    await waitFor(missing, () => /No camera was found/.test(document.querySelector('#status').textContent), 'no camera');
    const missingShapes = await missing.evaluate(() => window.__cameraCalls.map(call => call.video === true ? 'video:true' : (call.video.width ? 'ideal' : 'other')));
    assert.deepEqual(missingShapes, ['ideal', 'video:true']);

    const real = await context.newPage();
    const realErrors = [];
    real.on('pageerror', error => realErrors.push(String(error)));
    await real.route('**/wasm/**', route => route.abort());
    await real.goto(base);
    await real.locator('#camera-tab').click();
    await real.locator('#record').waitFor({state: 'visible', timeout: 15000});
    await real.locator('#record').click();
    await real.waitForTimeout(900);
    await real.locator('#record').click();
    await waitFor(real, () => !document.querySelector('#convert').disabled, 'synthetic camera file');
    await real.locator('#convert').click();
    await real.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').classList.contains('error'), null, {timeout: 60000});
    if (await real.locator('#status').evaluate(node => node.classList.contains('error'))) throw new Error(await real.locator('#status').innerText());
    assert.match(await real.locator('#status').innerText(), /Loop ready/);
    assert.deepEqual(realErrors, []);

    assert.deepEqual(errors, []);
    assert.deepEqual(denyErrors, []);
    console.log('PASS: camera enumeration, hot-plug, fallback, resize, recorder MIME, direct GIF, and error diagnostics');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
