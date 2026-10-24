import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {encodeGif} from '../web/gif-encoder.js';
import {geometry, planMotion} from '../web/motion.js';

function solid(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return {width, height, data};
}

const red = solid(8, 8, [255, 0, 0, 255]);
const blue = solid(8, 8, [0, 0, 255, 255]);
const opaque = Buffer.from(await (await encodeGif([red, blue], {fps: 10, dither: false, transparent: false})).arrayBuffer());
assert.equal(opaque.subarray(0, 6).toString(), 'GIF89a');
assert.ok(opaque.includes(Buffer.from('\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00', 'latin1')));
assert.equal(opaque[6] | (opaque[7] << 8), 8);
assert.equal(opaque[8] | (opaque[9] << 8), 8);

const mixed = {width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4)};
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 4; x++) {
    const i = (y * 4 + x) * 4;
    if (x < 2) mixed.data.set([255, 0, 0, 255], i);
  }
}
const transparent = Buffer.from(await (await encodeGif([mixed, mixed], {fps: 10, dither: false, transparent: true})).arrayBuffer());

const noise = {width: 96, height: 96, data: new Uint8ClampedArray(96 * 96 * 4)};
let seed = 123456789;
for (let i = 0; i < noise.data.length; i += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  noise.data[i] = seed & 255;
  noise.data[i + 1] = (seed >>> 8) & 255;
  noise.data[i + 2] = (seed >>> 16) & 255;
  noise.data[i + 3] = 255;
}
const noisy = Buffer.from(await (await encodeGif([noise], {fps: 5, dither: true, transparent: false})).arrayBuffer());

writeFileSync(process.argv[2], opaque);
writeFileSync(process.argv[3], transparent);
writeFileSync(process.argv[4], noisy);

assert.deepEqual(planMotion('Please gently float up and down.'), {effect: 'float', gentle: true});
assert.equal(planMotion('make the image zoom in').effect, 'zoom-in');
assert.equal(planMotion('make the image zoom in').gentle, false);
assert.equal(planMotion('rotate anticlockwise').effect, 'rotate-ccw');
for (const prompt of ['', "don't zoom in", 'pan left and make the cat wave', 'make the water ripple', '<script>pan left</script>', 'pan left 100 pixels', 'pan left; rm -rf /', 'make the person wave']) {
  assert.throws(() => planMotion(prompt), /whole-image/, prompt);
}
const layout = geometry(320, 200, planMotion('Gently float up and down'));
assert.equal(layout.width, 324);
assert.equal(layout.height, 212);
assert.equal(layout.transform.y, -4);
const zoom = geometry(100, 50, planMotion('zoom in'));
assert.equal(zoom.transform.scale, 1.08);
assert.equal(zoom.width, 114);
assert.equal(zoom.height, 60);
console.log('encoder and motion plan ok');
