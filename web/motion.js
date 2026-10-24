import {createGifEncoder, sampleFrame} from "./gif-encoder.js";

export const UNSUPPORTED_MOTION = "Try one whole-image instruction: float up and down, pan left, pan right, zoom in, zoom out, or rotate clockwise. Subject animation and combined instructions are not supported yet.";
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_FRAME_PIXELS = 120_000_000;

function asciiLower(value) {
  return value.replace(/[A-Z]/g, char => String.fromCharCode(char.charCodeAt(0) + 32));
}

function pyRound(value) {
  const lower = Math.floor(value);
  const diff = value - lower;
  if (diff > 0.5) return lower + 1;
  if (diff < 0.5) return lower;
  return lower % 2 === 0 ? lower : lower + 1;
}

export function planMotion(prompt) {
  if (new TextEncoder().encode(prompt).length > 240) throw new Error(UNSUPPORTED_MOTION);
  const lower = asciiLower(prompt.trim().replace(/\.+$/, ""));
  const words = lower.split(/\s+/).filter(Boolean);
  const gentle = words.includes("gently") || words.includes("subtly");
  const text = words.filter(word => !["please", "gently", "subtly"].includes(word)).join(" ")
    .replace(/^(?:make the image |make the photo |make it )/, "");
  const effect = {
    float: "float",
    "float up and down": "float",
    "move up and down": "float",
    "pan left": "pan-left",
    "move left": "pan-left",
    "pan left and back": "pan-left",
    "pan right": "pan-right",
    "move right": "pan-right",
    "pan right and back": "pan-right",
    "zoom in": "zoom-in",
    "zoom in and back out": "zoom-in",
    "zoom out": "zoom-out",
    "zoom out and back in": "zoom-out",
    "rotate clockwise": "rotate-cw",
    "rotate clockwise and back": "rotate-cw",
    "rotate counterclockwise": "rotate-ccw",
    "rotate anticlockwise": "rotate-ccw",
    "rotate counterclockwise and back": "rotate-ccw",
  }[text];
  if (!effect) throw new Error(UNSUPPORTED_MOTION);
  return {effect, gentle};
}

export function geometry(width, height, plan) {
  const amount = plan.gentle ? 0.02 : 0.04;
  const dx = Math.max(2, pyRound(width * amount));
  const dy = Math.max(2, pyRound(height * amount));
  let padX = 2, padY = 2;
  const transform = {};
  if (plan.effect === "float") {
    padY += dy;
    transform.y = -dy;
  } else if (plan.effect === "pan-left" || plan.effect === "pan-right") {
    padX += dx;
    transform.x = dx * (plan.effect === "pan-left" ? -1 : 1);
  } else if (plan.effect === "zoom-in" || plan.effect === "zoom-out") {
    const scale = 1 + amount * (plan.effect === "zoom-in" ? 2 : -2);
    padX += Math.ceil(width * Math.max(0, scale - 1) / 2);
    padY += Math.ceil(height * Math.max(0, scale - 1) / 2);
    transform.scale = scale;
  } else {
    const degrees = plan.gentle ? 3 : 6;
    const radians = degrees * Math.PI / 180;
    padX += Math.ceil(Math.max(0, height * Math.sin(radians) + width * Math.cos(radians) - width) / 2);
    padY += Math.ceil(Math.max(0, width * Math.sin(radians) + height * Math.cos(radians) - height) / 2);
    transform.rotation = degrees * (plan.effect === "rotate-ccw" ? -1 : 1);
  }
  return {
    width: width + 2 * padX,
    height: height + 2 * padY,
    left: padX,
    top: padY,
    imageWidth: width,
    imageHeight: height,
    transform,
  };
}

function sniff(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "jpeg";
  if (bytes.length >= 12 && asciiFrom(bytes, 0, 4) === "RIFF" && asciiFrom(bytes, 8, 4) === "WEBP") return "webp";
  return "";
}

function asciiFrom(bytes, start, length) {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[start + i]);
  return text;
}

function animatedPng(bytes) {
  let offset = 8;
  while (offset + 8 < bytes.length) {
    const size = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const tag = asciiFrom(bytes, offset + 4, 4);
    if (tag === "acTL") return true;
    if (tag === "IDAT" || tag === "IEND") return false;
    offset += 12 + size;
  }
  return false;
}

function animatedWebp(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = asciiFrom(bytes, offset, 4);
    const size = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
    if (tag === "ANIM" || tag === "ANMF") return true;
    if (tag === "VP8X" && offset + 8 < bytes.length && (bytes[offset + 8] & 2)) return true;
    offset += 8 + size + (size & 1);
  }
  return false;
}

async function loadStill(file) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a nonempty image smaller than 20 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind || (kind === "png" && animatedPng(bytes)) || (kind === "webp" && animatedWebp(bytes))) {
    throw new Error("Choose a single still PNG, JPEG, or WebP image");
  }
  const blob = new Blob([bytes]);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {imageOrientation: "from-image", premultiplyAlpha: "none"});
  } catch {
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error("This image cannot be decoded safely. Choose a smaller valid PNG, JPEG, or WebP"); }
  }
  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close();
    throw new Error("Choose an image with at most 20 million pixels");
  }
  return bitmap;
}

function fittedSource(bitmap, width, originalSize) {
  if (originalSize || bitmap.width <= width) return bitmap;
  const dw = width;
  const dh = Math.max(1, pyRound(bitmap.height * dw / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", {alpha: true});
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  return canvas;
}

function envelope(index, fps, duration) {
  const t = index / fps;
  const half = duration / 2;
  const local = Math.min(1, Math.max(0, t <= half ? t / half : (duration - t) / half));
  return -(Math.cos(Math.PI * local) - 1) / 2;
}

function drawFrame(ctx, source, index, fps, duration, layout) {
  ctx.clearRect(0, 0, layout.width, layout.height);
  const amount = envelope(index, fps, duration);
  const dx = layout.transform.x ? Math.round(layout.transform.x * amount) : 0;
  const dy = layout.transform.y ? Math.round(layout.transform.y * amount) : 0;
  const rotation = layout.transform.rotation ? layout.transform.rotation * amount : 0;
  const scale = layout.transform.scale ? 1 + (layout.transform.scale - 1) * amount : 1;
  const smooth = rotation !== 0 || scale !== 1;
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = "high";
  if (!smooth) ctx.drawImage(source, layout.left + dx, layout.top + dy, layout.imageWidth, layout.imageHeight);
  else {
    ctx.translate(layout.left + layout.imageWidth / 2 + dx, layout.top + layout.imageHeight / 2 + dy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(source, -layout.imageWidth / 2, -layout.imageHeight / 2, layout.imageWidth, layout.imageHeight);
  }
  ctx.restore();
}

export async function animateImage({file, prompt, fps, width, duration, originalSize, signal, onProgress}) {
  if (!Number.isInteger(fps) || !Number.isInteger(width) || !Number.isInteger(duration) ||
      fps < 1 || fps > 30 || width < 100 || width > 800 || duration < 1 || duration > 6 || fps * duration < 2) {
    throw new Error("Use 1–30 FPS, 100–800 pixels, and a 1–6 second loop with at least two frames");
  }
  const plan = planMotion(prompt);
  onProgress?.("Rendering your original image into a loop…");
  const bitmap = await loadStill(file);
  try {
    const source = fittedSource(bitmap, width, originalSize);
    const layout = geometry(source.width, source.height, plan);
    const count = fps * duration;
    if (layout.width > 1800 || layout.height > 1800 || layout.width * layout.height * count > MAX_FRAME_PIXELS) {
      throw new Error("Image and loop are too large. Turn off original size, choose a smaller width, or reduce FPS/duration");
    }
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d", {willReadFrequently: true, alpha: true});
    const samples = [];
    const state = {seen: 0, stride: Math.max(1, Math.floor(layout.width * layout.height * count / 120000))};
    const frames = [];
    for (let index = 0; index < count; index++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      onProgress?.(`Rendering frame ${index + 1} of ${count}…`);
      drawFrame(ctx, source, index, fps, duration, layout);
      const frame = ctx.getImageData(0, 0, layout.width, layout.height);
      sampleFrame(frame, samples, state);
      frames.push(frame);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    onProgress?.("Encoding your GIF…");
    const encoder = createGifEncoder({width: layout.width, height: layout.height, samples, fps, transparent: true, dither: false});
    for (const frame of frames) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      encoder.add(frame);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {blob: encoder.finish(), fps, width: layout.width, height: layout.height};
  } finally {
    bitmap.close?.();
  }
}
