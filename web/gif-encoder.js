// Global-palette GIF89a encoder. One palette covers the whole loop.
// Video frames can be dithered; still motion stays undithered so flat areas do not shimmer.

const BITS = 12;

function medianCut(samples, maxColors) {
  const colors = samples instanceof Uint32Array ? samples : Uint32Array.from(samples);
  if (!colors.length) return new Uint8Array([0, 0, 0]);
  const boxes = [{start: 0, end: colors.length}];
  while (boxes.length < maxColors) {
    let pick = -1, range = 0, channel = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.end - box.start < 2) continue;
      const stats = channelRange(colors, box.start, box.end);
      if (stats.range > range) {
        range = stats.range;
        pick = i;
        channel = stats.channel;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    sortChannel(colors, box.start, box.end, channel);
    const mid = (box.start + box.end) >> 1;
    boxes.splice(pick, 1, {start: box.start, end: mid}, {start: mid, end: box.end});
  }
  const out = new Uint8Array(boxes.length * 3);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    let r = 0, g = 0, b = 0;
    const count = box.end - box.start;
    for (let i = box.start; i < box.end; i++) {
      const color = colors[i];
      r += color >>> 16;
      g += (color >>> 8) & 255;
      b += color & 255;
    }
    const offset = index * 3;
    out[offset] = Math.round(r / count);
    out[offset + 1] = Math.round(g / count);
    out[offset + 2] = Math.round(b / count);
  }
  return out;
}

function channelRange(colors, start, end) {
  let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
  for (let i = start; i < end; i++) {
    const color = colors[i];
    const r = color >>> 16, g = (color >>> 8) & 255, b = color & 255;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (g < g0) g0 = g;
    if (g > g1) g1 = g;
    if (b < b0) b0 = b;
    if (b > b1) b1 = b;
  }
  const rr = r1 - r0, gg = g1 - g0, bb = b1 - b0;
  if (gg >= rr && gg >= bb) return {range: gg, channel: 1};
  if (rr >= bb) return {range: rr, channel: 0};
  return {range: bb, channel: 2};
}

function sortChannel(colors, start, end, channel) {
  const shift = channel === 0 ? 16 : channel === 1 ? 8 : 0;
  const part = Array.from(colors.subarray(start, end));
  part.sort((a, b) => ((a >>> shift) & 255) - ((b >>> shift) & 255));
  colors.set(part, start);
}

function fitPalette(colors, transparent) {
  const palette = new Uint8Array(256 * 3);
  if (transparent) palette.set(colors.subarray(0, Math.min(colors.length, 255 * 3)), 3);
  else palette.set(colors.subarray(0, Math.min(colors.length, 256 * 3)));
  return palette;
}

function buildLut(palette, transparentIndex) {
  const usable = [];
  const pr = new Int16Array(256), pg = new Int16Array(256), pb = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    if (i === transparentIndex) continue;
    pr[i] = palette[i * 3];
    pg[i] = palette[i * 3 + 1];
    pb[i] = palette[i * 3 + 2];
    usable.push(i);
  }
  const lut = new Uint8Array(32768);
  const first = usable[0] || 0;
  for (let r = 0; r < 32; r++) {
    const R = (r << 3) | (r >> 2);
    for (let g = 0; g < 32; g++) {
      const G = (g << 3) | (g >> 2);
      const rg = (r << 10) | (g << 5);
      for (let b = 0; b < 32; b++) {
        const B = (b << 3) | (b >> 2);
        let best = first, bestD = 1e15;
        for (let k = 0; k < usable.length; k++) {
          const i = usable[k];
          const dr = R - pr[i], dg = G - pg[i], db = B - pb[i];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestD) {
            bestD = dist;
            best = i;
            if (!dist) break;
          }
        }
        lut[rg | b] = best;
      }
    }
  }
  return lut;
}

export function quantize(samples, transparent) {
  const colors = medianCut(samples.length ? samples : [0], transparent ? 255 : 256);
  const palette = fitPalette(colors, transparent);
  const transparentIndex = transparent ? 0 : -1;
  return {palette, lut: buildLut(palette, transparentIndex), transparentIndex};
}

export function sampleFrame(frame, samples, state) {
  const data = frame.data;
  const count = frame.width * frame.height;
  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    if (data[i + 3] < 128) continue;
    if (state.seen++ % state.stride === 0) samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
}

function clamp(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function indexFrame(frame, lut, palette, dither, transparentIndex) {
  const {width, height, data} = frame;
  const idx = new Uint8Array(width * height);
  if (!dither) {
    for (let pixel = 0, i = 0; pixel < idx.length; pixel++, i += 4) {
      idx[pixel] = transparentIndex >= 0 && data[i + 3] < 128
        ? transparentIndex
        : lut[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)];
    }
    return idx;
  }
  const red = new Float32Array(idx.length);
  const green = new Float32Array(idx.length);
  const blue = new Float32Array(idx.length);
  for (let pixel = 0, i = 0; pixel < idx.length; pixel++, i += 4) {
    red[pixel] = data[i];
    green[pixel] = data[i + 1];
    blue[pixel] = data[i + 2];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const alpha = data[pixel * 4 + 3];
      if (transparentIndex >= 0 && alpha < 128) {
        idx[pixel] = transparentIndex;
        continue;
      }
      const R = clamp(red[pixel]), G = clamp(green[pixel]), B = clamp(blue[pixel]);
      const chosen = lut[((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3)];
      idx[pixel] = chosen;
      const er = R - palette[chosen * 3];
      const eg = G - palette[chosen * 3 + 1];
      const eb = B - palette[chosen * 3 + 2];
      const spread = (xx, yy, factor) => {
        if (xx < 0 || xx >= width || yy >= height) return;
        const next = yy * width + xx;
        if (transparentIndex >= 0 && data[next * 4 + 3] < 128) return;
        red[next] += er * factor;
        green[next] += eg * factor;
        blue[next] += eb * factor;
      };
      spread(x + 1, y, 7 / 16);
      spread(x - 1, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + 1, y + 1, 1 / 16);
    }
  }
  return idx;
}

class Buf {
  constructor() { this.parts = []; this.length = 0; }
  u8(value) { this.parts.push(Uint8Array.of(value & 255)); this.length++; }
  u16(value) { this.u8(value); this.u8(value >> 8); }
  bytes(value) { this.parts.push(value); this.length += value.length; }
  text(value) { this.bytes(new TextEncoder().encode(value)); }
  concat() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

// Variable-width LZW with the GIF clear-code timing decoders expect.
function lzwEncode(pixels) {
  const initCodeSize = 8;
  const initBits = initCodeSize + 1;
  const clearCode = 1 << (initBits - 1);
  const eoiCode = clearCode + 1;
  let nBits = initBits;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = clearCode + 2;
  let clearFlag = false;
  const dict = new Map();
  const packed = [];
  let acc = 0, bits = 0;

  const emit = byte => packed.push(byte);
  const output = code => {
    acc |= code << bits;
    bits += nBits;
    while (bits >= 8) {
      emit(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
    if (freeEnt > maxCode || clearFlag) {
      if (clearFlag) {
        nBits = initBits;
        maxCode = (1 << nBits) - 1;
        clearFlag = false;
      } else {
        nBits++;
        maxCode = nBits === BITS ? (1 << nBits) : (1 << nBits) - 1;
      }
    }
    if (code === eoiCode) {
      while (bits > 0) {
        emit(acc & 255);
        acc >>>= 8;
        bits -= 8;
      }
    }
  };

  output(clearCode);
  let ent = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const color = pixels[i];
    const key = (ent << 8) | color;
    const found = dict.get(key);
    if (found !== undefined) {
      ent = found;
      continue;
    }
    output(ent);
    if (freeEnt < (1 << BITS)) dict.set(key, freeEnt++);
    else {
      dict.clear();
      freeEnt = clearCode + 2;
      clearFlag = true;
      output(clearCode);
    }
    ent = color;
  }
  output(ent);
  output(eoiCode);
  return Uint8Array.from(packed);
}

function writeSubBlocks(buf, bytes) {
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 255));
    buf.u8(chunk.length);
    buf.bytes(chunk);
  }
  buf.u8(0);
}

function delayCs(fps) {
  const cs = Math.round(100 / fps);
  return Math.min(65535, Math.max(2, cs || 2));
}

class GifWriter {
  constructor(width, height, palette, fps, transparentIndex) {
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new Error('GIF dimensions are out of range');
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.delay = delayCs(fps);
    this.transparentIndex = transparentIndex;
    this.buf = new Buf();
    this.buf.text('GIF89a');
    this.buf.u16(width);
    this.buf.u16(height);
    this.buf.u8(0xF7);
    this.buf.u8(0);
    this.buf.u8(0);
    this.buf.bytes(palette);
    this.buf.u8(0x21); this.buf.u8(0xFF); this.buf.u8(0x0B);
    this.buf.text('NETSCAPE2.0');
    this.buf.u8(0x03); this.buf.u8(0x01); this.buf.u16(0); this.buf.u8(0);
  }
  addIndexed(indexed) {
    if (indexed.length !== this.width * this.height) throw new Error('Unable to encode a GIF frame');
    const transparent = this.transparentIndex >= 0;
    this.buf.u8(0x21); this.buf.u8(0xF9); this.buf.u8(0x04);
    this.buf.u8(transparent ? 0x09 : 0x04);
    this.buf.u16(this.delay);
    this.buf.u8(transparent ? this.transparentIndex : 0);
    this.buf.u8(0);
    this.buf.u8(0x2C);
    this.buf.u16(0); this.buf.u16(0); this.buf.u16(this.width); this.buf.u16(this.height);
    this.buf.u8(0);
    this.buf.u8(8);
    writeSubBlocks(this.buf, lzwEncode(indexed));
  }
  finish() {
    this.buf.u8(0x3B);
    return new Blob([this.buf.concat()], {type: 'image/gif'});
  }
}

export function createGifEncoder({width, height, samples, fps, transparent = false, dither = false}) {
  const quant = quantize(samples, transparent);
  const writer = new GifWriter(width, height, quant.palette, fps, quant.transparentIndex);
  return {
    add(frame) {
      writer.addIndexed(indexFrame(frame, quant.lut, quant.palette, dither, quant.transparentIndex));
    },
    finish: () => writer.finish(),
  };
}

export async function encodeGif(frames, options = {}) {
  if (!frames.length) throw new Error('Unable to encode an empty GIF');
  const width = frames[0].width, height = frames[0].height;
  const stride = Math.max(1, Math.floor(width * height * frames.length / 120000));
  const samples = [];
  const state = {seen: 0, stride};
  for (const frame of frames) {
    sampleFrame(frame, samples, state);
    if (options.tick) await options.tick();
  }
  const encoder = createGifEncoder({
    width, height, samples, fps: options.fps, transparent: options.transparent, dither: options.dither,
  });
  for (const frame of frames) {
    encoder.add(frame);
    if (options.tick) await options.tick();
  }
  return encoder.finish();
}
