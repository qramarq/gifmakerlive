// Camera classes and delivery frames for smartphone and digital cinema sources.
// Output width stays in the studio's 100–800 px range. Height follows the frame.

export const MIN_WIDTH = 100;
export const MAX_WIDTH = 800;
export const MAX_HEIGHT = 4096;
export const MAX_FRAME_PIXELS = 1_600_000;
export const MAX_LOOP_PIXELS = 80_000_000;
// DCI 4K / 2K is 4096×2160 (256:135, about 1.896:1), the ratio marketed as 17:9.
export const DCI_ASPECT = 4096 / 2160;

export const PROFILES = {
  match: {id: "match", label: "Auto / Match camera"},
  "phone-9-16": {id: "phone-9-16", label: "Smartphone 9:16 vertical", aspect: 9 / 16},
  "phone-16-9": {id: "phone-16-9", label: "Smartphone 16:9 horizontal", aspect: 16 / 9},
  "phone-4-3": {id: "phone-4-3", label: "Smartphone 4:3 sensor", aspect: 4 / 3},
  "phone-3-4": {id: "phone-3-4", label: "Smartphone 3:4 portrait", aspect: 3 / 4},
  "phone-1-1": {id: "phone-1-1", label: "Smartphone 1:1", aspect: 1},
  "dci-17-9": {id: "dci-17-9", label: "DCI 17:9", aspect: DCI_ASPECT},
  "uhd-16-9": {id: "uhd-16-9", label: "UHD 16:9", aspect: 16 / 9},
  "scope-239": {id: "scope-239", label: "Cinema Scope 2.39:1", aspect: 2.39},
  "univisium-200": {id: "univisium-200", label: "Univisium 2.00:1", aspect: 2},
  "flat-185": {id: "flat-185", label: "Flat 1.85:1", aspect: 1.85},
  "open-gate-32": {id: "open-gate-32", label: "Open Gate 3:2", aspect: 3 / 2},
  "anamorphic-43": {id: "anamorphic-43", label: "Anamorphic 4:3 sensor", aspect: 4 / 3},
  "desqueeze-133": {id: "desqueeze-133", label: "Anamorphic desqueeze 1.33×", desqueeze: 1.33},
  "desqueeze-150": {id: "desqueeze-150", label: "Anamorphic desqueeze 1.5×", desqueeze: 1.5},
  "desqueeze-180": {id: "desqueeze-180", label: "Anamorphic desqueeze 1.8×", desqueeze: 1.8},
  "desqueeze-200": {id: "desqueeze-200", label: "Anamorphic desqueeze 2×", desqueeze: 2},
  custom: {id: "custom", label: "Custom width × height"},
};

const SHORT_NAME = {
  "phone-9-16": "9:16 vertical",
  "phone-16-9": "16:9 horizontal",
  "phone-4-3": "4:3 sensor",
  "phone-3-4": "3:4 portrait",
  "phone-1-1": "1:1 square",
  "dci-17-9": "DCI 17:9",
  "uhd-16-9": "UHD 16:9",
  "scope-239": "Scope 2.39:1",
  "univisium-200": "Univisium 2.00:1",
  "flat-185": "Flat 1.85:1",
  "open-gate-32": "Open Gate 3:2",
  "anamorphic-43": "Anamorphic 4:3",
};

// Exact sensor and delivery sizes win over a loose aspect match.
const EXACT_SIZES = new Map([
  ["4096x2160", "dci-17-9"],
  ["2048x1080", "dci-17-9"],
  ["4096x1716", "scope-239"],
  ["2048x858", "scope-239"],
  ["3996x2160", "flat-185"],
  ["1998x1080", "flat-185"],
  ["3840x1920", "univisium-200"],
  ["1920x960", "univisium-200"],
  ["3840x2160", "uhd-16-9"],
  ["4096x3072", "anamorphic-43"],
  ["2880x2160", "anamorphic-43"],
  ["2048x1536", "anamorphic-43"],
  ["6000x4000", "open-gate-32"],
  ["6048x4032", "open-gate-32"],
  ["5760x3840", "open-gate-32"],
  ["4608x3072", "open-gate-32"],
  ["2160x3840", "phone-9-16"],
  ["1080x1920", "phone-9-16"],
  ["720x1280", "phone-9-16"],
  ["1080x1440", "phone-3-4"],
  ["3024x4032", "phone-3-4"],
  ["1080x1080", "phone-1-1"],
  ["2160x2160", "phone-1-1"],
  ["4032x3024", "phone-4-3"],
  ["4000x3000", "phone-4-3"],
]);

const ASPECT_CANDIDATES = [
  {id: "phone-1-1", aspect: 1, delta: 0.02},
  {id: "phone-9-16", aspect: 9 / 16, delta: 0.02},
  {id: "phone-3-4", aspect: 3 / 4, delta: 0.02},
  {id: "phone-4-3", aspect: 4 / 3, delta: 0.025},
  {id: "open-gate-32", aspect: 3 / 2, delta: 0.02},
  {id: "widescreen-16-9", aspect: 16 / 9, delta: 0.02},
  {id: "flat-185", aspect: 1.85, delta: 0.015},
  {id: "dci-17-9", aspect: DCI_ASPECT, delta: 0.012},
  {id: "univisium-200", aspect: 2, delta: 0.02},
  {id: "scope-239", aspect: 2.39, delta: 0.025},
];

const CINEMA_IDS = new Set(["dci-17-9", "scope-239", "flat-185", "univisium-200", "open-gate-32", "anamorphic-43"]);
const PHONE_CLASS_IDS = new Set(["phone-9-16", "phone-3-4", "phone-1-1", "phone-4-3"]);
const PHONE_LABEL = /iphone|ipad|pixel|galaxy|android|smartphone|\bphone\b|facetime|selfie|ultra\s?wide|ultrawide|telephoto|front camera|back camera|rear camera/i;
const CINEMA_LABEL = /blackmagic|bmpcc|pyxis|\barri\b|alexa|\bred\b|komodo|v-raptor|venice|\bfx[369]\b|\bc70\b|\bc300\b|\bc500\b|z-?cam|kinefinity|sigma fp|atomos|shogun|\bninja\b|decklink|ultrastudio|elgato|cam\s*link|magewell|\batem\b|\bhdmi\b|\bsdi\b|capture card|open\s?gate|super\s?35|\bs35\b|anamorphic/i;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function closestAspect(aspect) {
  let best = null;
  for (const candidate of ASPECT_CANDIDATES) {
    const distance = Math.abs(aspect - candidate.aspect);
    if (distance <= candidate.delta && (!best || distance < best.distance)) best = {id: candidate.id, distance};
  }
  return best ? best.id : "";
}

function signals(label, facingMode) {
  const facing = facingMode === "user" ? "front" : facingMode === "environment" ? "rear" : "";
  const lens = /ultra\s?wide|ultrawide|0\.5\s*x/i.test(label) ? "ultrawide" : /telephoto|\btele\b/i.test(label) ? "telephoto" : "";
  const fromLabel = !facing && (/front|facetime|selfie/i.test(label) ? "front" : /\brear\b|\bback\b/i.test(label) ? "rear" : "");
  return {
    facing: facing || fromLabel,
    lens,
    phone: Boolean(facingMode === "user" || facingMode === "environment") || PHONE_LABEL.test(label),
    cinema: CINEMA_LABEL.test(label),
    super35: /super\s*35|\bs35\b/i.test(label),
    openGate: /open\s*gate/i.test(label),
    anamorphic: /anamorphic/i.test(label),
  };
}

function refineFormat(formatId, cameraClass, width, height) {
  let id = formatId === "widescreen-16-9" ? "phone-16-9" : formatId;
  if (cameraClass === "smartphone" && id === "uhd-16-9") id = "phone-16-9";
  if (cameraClass === "smartphone" && id === "anamorphic-43") id = "phone-4-3";
  if (cameraClass === "digital-cinema" && (id === "phone-16-9" || id === "widescreen-16-9")) id = "uhd-16-9";
  if (cameraClass === "digital-cinema" && id === "phone-4-3") id = "anamorphic-43";
  if (cameraClass === "unknown" && (id === "phone-16-9" || id === "widescreen-16-9")) {
    id = Math.min(width, height) >= 1080 ? "uhd-16-9" : "phone-16-9";
  }
  return id;
}

export function detectCameraFormat(input = {}) {
  const width = positiveNumber(input.width);
  const height = positiveNumber(input.height);
  const label = String(input.label || "").slice(0, 240);
  const facingMode = input.facingMode === "user" || input.facingMode === "environment" ? input.facingMode : "";
  let aspect = width && height ? width / height : 0;
  if (!aspect && positiveNumber(input.aspectRatio)) aspect = Number(input.aspectRatio);
  const hint = signals(label, facingMode);
  const empty = {
    cameraClass: "unknown",
    formatId: "",
    orientation: "",
    facing: hint.facing,
    lens: hint.lens,
    sensor: "",
    width, height, aspect, label, facingMode,
  };
  if (!aspect) return empty;
  const orientation = Math.abs(aspect - 1) <= 0.02 ? "square" : aspect < 1 ? "portrait" : "landscape";
  const exactId = width && height ? (EXACT_SIZES.get(`${Math.round(width)}x${Math.round(height)}`) || "") : "";
  const formatGuess = exactId || closestAspect(aspect);
  let cameraClass = "unknown";
  const exclusive = CINEMA_IDS.has(formatGuess) && formatGuess !== "uhd-16-9";
  if (hint.phone && !exclusive) cameraClass = "smartphone";
  else if (hint.cinema || hint.super35 || hint.openGate || hint.anamorphic || (exactId && exclusive)) cameraClass = "digital-cinema";
  const formatId = refineFormat(formatGuess, cameraClass, width, height);
  if (cameraClass === "unknown" && PHONE_CLASS_IDS.has(formatId)) cameraClass = "smartphone";
  if (cameraClass === "unknown" && CINEMA_IDS.has(formatId) && formatId !== "uhd-16-9") {
    const largeGate = formatId !== "open-gate-32" || Math.max(width, height) >= 2000;
    if (largeGate) cameraClass = "digital-cinema";
  }
  const sensor = hint.super35 ? "super35" : hint.openGate ? "open-gate" : hint.anamorphic ? "anamorphic" : "";
  return {...empty, cameraClass, formatId, orientation, aspect, sensor};
}

export function describeCamera(detection) {
  if (!detection?.formatId) return "";
  const name = SHORT_NAME[detection.formatId] || detection.formatId;
  const parts = [];
  if (detection.cameraClass === "smartphone") parts.push("Smartphone");
  else if (detection.cameraClass === "digital-cinema") parts.push("Digital cinema");
  parts.push(name);
  if (detection.facing) parts.push(detection.facing === "front" ? "front camera" : "rear camera");
  if (detection.lens) parts.push(detection.lens);
  if (detection.sensor === "super35") parts.push("Super 35");
  return parts.join(" · ");
}

export function requireWidth(width) {
  if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
    throw new Error("Use a width of 100–800 pixels");
  }
  return width;
}

export function requireHeight(height) {
  if (!Number.isInteger(height) || height < 2 || height > MAX_HEIGHT) {
    throw new Error("Use a height of 2–4096 pixels");
  }
  return height;
}

// Snap an inexact height to the nearer even pixel. Exact integers stay exact,
// including a square frame on an odd width.
export function heightForAspect(width, aspect) {
  if (!(aspect > 0) || !(width > 0)) throw new Error("Invalid camera aspect");
  const exact = width / aspect;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) < 1e-6) return Math.max(1, rounded);
  let height = rounded;
  if (height % 2 !== 0) {
    const lower = height - 1;
    const upper = height + 1;
    height = Math.abs(lower - exact) <= Math.abs(upper - exact) ? lower : upper;
  }
  return Math.max(2, height);
}

function normalizeCrop(crop) {
  const values = Array.isArray(crop) && crop.length === 4 ? crop.map(Number) : [0, 0, 100, 100];
  if (values.some(value => !Number.isFinite(value))) throw new Error("Invalid video edits");
  const [x, y, w, h] = values;
  if (Math.min(x, y) < 0 || Math.min(w, h) < 1 || x + w > 100 || y + h > 100) {
    throw new Error("Crop must fit inside the video and be at least 1% wide and high");
  }
  return [x, y, w, h];
}

export function outputDimensions({
  profileId = "match",
  framing = "crop",
  width,
  height,
  sourceWidth = 0,
  sourceHeight = 0,
  crop = [0, 0, 100, 100],
} = {}) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error("Choose a camera format");
  const outWidth = requireWidth(width);
  const [x, y, cw, ch] = normalizeCrop(crop);
  const sw = positiveNumber(sourceWidth) * cw / 100;
  const sh = positiveNumber(sourceHeight) * ch / 100;
  const sourceAspect = sw > 0 && sh > 0 ? sw / sh : 0;
  let outHeight = 0;
  let aspect = 0;
  let desqueeze = 1;
  let mode = framing === "fit" ? "fit" : "crop";
  let pending = false;
  if (profile.desqueeze) {
    desqueeze = profile.desqueeze;
    mode = "crop";
    if (!sourceAspect) pending = true;
    else {
      aspect = sourceAspect * desqueeze;
      outHeight = heightForAspect(outWidth, aspect);
    }
  } else if (profile.aspect) {
    aspect = profile.aspect;
    outHeight = heightForAspect(outWidth, aspect);
  } else if (profile.id === "custom") {
    outHeight = requireHeight(height);
    aspect = outWidth / outHeight;
  } else if (sourceAspect) {
    outHeight = Math.max(1, Math.round(sh * outWidth / sw));
    aspect = outWidth / outHeight;
  } else pending = true;
  if (outHeight && (outHeight > MAX_HEIGHT || outWidth * outHeight > MAX_FRAME_PIXELS)) {
    throw new Error("This frame is too large for the browser. Choose a smaller width.");
  }
  return {
    width: outWidth,
    height: outHeight,
    aspect,
    framing: mode,
    desqueeze,
    profileId: profile.id,
    pending,
    crop: [x, y, cw, ch],
  };
}

// Map the cropped source into the output frame without stretching it.
// Desqueeze is the one intentional horizontal scale: it unsqueezes anamorphic pixels.
export function placeSource({
  sourceWidth,
  sourceHeight,
  crop = [0, 0, 100, 100],
  outWidth,
  outHeight,
  framing = "crop",
  desqueeze = 1,
}) {
  const [x, y, cw, ch] = normalizeCrop(crop);
  const sx = sourceWidth * x / 100;
  const sy = sourceHeight * y / 100;
  const sw = sourceWidth * cw / 100;
  const sh = sourceHeight * ch / 100;
  if (!(sw > 0) || !(sh > 0) || !(outWidth > 0) || !(outHeight > 0)) throw new Error("Invalid video edits");
  const factor = desqueeze > 0 ? desqueeze : 1;
  const displayW = sw * factor;
  const displayH = sh;
  const scale = framing === "fit"
    ? Math.min(outWidth / displayW, outHeight / displayH)
    : Math.max(outWidth / displayW, outHeight / displayH);
  const dw = displayW * scale;
  const dh = displayH * scale;
  return {sx, sy, sw, sh, dx: (outWidth - dw) / 2, dy: (outHeight - dh) / 2, dw, dh, outWidth, outHeight};
}

export function assertLoopBudget(width, height, frames) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) {
    throw new Error("GIF dimensions are out of range");
  }
  if (width * height > MAX_FRAME_PIXELS) {
    throw new Error("This frame is too large for the browser. Choose a smaller width.");
  }
  if (!Number.isInteger(frames) || frames < 1 || frames * width * height > MAX_LOOP_PIXELS) {
    throw new Error("This loop is too large for the browser. Lower the frame rate or width and try again.");
  }
}

export function formatReadout({sized, detection, imageMode = false, originalSize = false} = {}) {
  if (imageMode && originalSize) {
    return "Original image size stays on. Turn it off to frame the loop with a camera format.";
  }
  if (!sized || sized.pending) {
    if (sized?.profileId?.startsWith("desqueeze")) return "Load a camera clip to desqueeze its sensor.";
    return "Output follows the camera frame. Width stays 100–800 px.";
  }
  const size = `${sized.width}×${sized.height}`;
  const frame = sized.framing === "fit" ? "fit inside" : "crop to fill";
  const detected = describeCamera(detection);
  if (sized.profileId === "match") return detected ? `Match camera · ${detected} · ${size}` : `Match camera · ${size}`;
  const name = PROFILES[sized.profileId]?.label || "Custom frame";
  const lead = detected ? `Detected ${detected}. ` : "";
  const motion = imageMode ? " Motion padding is added around this frame." : "";
  return `${lead}${name} · ${size} · ${frame}.${motion}`;
}
