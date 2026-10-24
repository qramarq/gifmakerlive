import {createGifEncoder, sampleFrame} from "./gif-encoder.js";

const MEMORY_BUDGET = 48 * 1024 * 1024;

function finiteDuration(video) {
  const duration = video.duration;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function seek(video, time) {
  const duration = finiteDuration(video);
  const target = duration ? Math.min(Math.max(0, time), Math.max(0, duration - 0.001)) : Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error("Unable to decode this video or apply its edits")), 10000);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => fail(new Error("Unable to decode this video or apply its edits"));
    const fail = error => { cleanup(); reject(error); };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try { video.currentTime = target; }
    catch (error) { fail(error); }
  });
}

async function measureDuration(video) {
  const known = finiteDuration(video);
  if (known) return known;
  await seek(video, 1e101);
  const end = video.currentTime;
  if (!(end > 0) || !Number.isFinite(end)) throw new Error("Unable to determine the video length. Try an MP4 video");
  return end;
}

function mapTime(time, segments) {
  let cursor = 0;
  for (let index = 0; index < segments.length; index++) {
    const [start, end] = segments[index];
    const length = end - start;
    if (time < cursor + length || index === segments.length - 1) {
      return start + Math.min(Math.max(0, time - cursor), Math.max(0, length - 0.0005));
    }
    cursor += length;
  }
  return segments[0][0];
}

function prepareEdits(edits, duration) {
  if (!edits || !Array.isArray(edits.segments) || edits.segments.length < 1 || edits.segments.length > 10) {
    throw new Error("Choose between one and ten segments");
  }
  let segments = edits.segments.map(segment => [Number(segment[0]), Number(segment[1])]);
  // The default five-second selection is longer than a short camera recording.
  if (segments.length === 1 && segments[0][0] === 0 && segments[0][1] === 5 && duration > 0 && duration < 5) {
    segments = [[0, duration]];
  }
  let total = 0;
  for (const [start, end] of segments) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("Each segment must end after it starts");
    }
    total += end - start;
  }
  if (total > 5 + 1e-9) throw new Error("Selected segments must total no more than 5 seconds");
  if (duration > 0 && segments.some(([, end]) => end > duration + 0.05)) {
    throw new Error("A selected segment extends past the end of the video");
  }
  const crop = edits.crop || [0, 0, 100, 100];
  if (crop.length !== 4 || crop.some(value => !Number.isFinite(Number(value)))) throw new Error("Invalid video edits");
  const [x, y, w, h] = crop.map(Number);
  if (Math.min(x, y) < 0 || Math.min(w, h) < 1 || x + w > 100 || y + h > 100) {
    throw new Error("Crop must fit inside the video and be at least 1% wide and high");
  }
  return {segments, crop: [x, y, w, h], total: Math.min(5, total)};
}

async function grab(video, ctx, when, rect) {
  await seek(video, when);
  await new Promise(resolve => requestAnimationFrame(resolve));
  ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.outW, rect.outH);
  return ctx.getImageData(0, 0, rect.outW, rect.outH);
}

export async function convertVideo({video, edits, fps, width, signal, onProgress}) {
  if (!Number.isInteger(fps) || !Number.isInteger(width) || fps < 1 || fps > 30 || width < 100 || width > 800) {
    throw new Error("Use 1–30 FPS and a width of 100–800 pixels");
  }
  if (!video.videoWidth) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("This browser can't decode that video. Use an MP4 or WebM it can play.")), 5000);
      const ready = () => {
        if (!video.videoWidth) return;
        clearTimeout(timer);
        resolve();
      };
      video.addEventListener("loadeddata", ready, {once: true});
      video.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("This browser can't decode that video. Use an MP4 or WebM it can play."));
      }, {once: true});
      ready();
    });
  }
  const inferred = !finiteDuration(video);
  onProgress?.(inferred ? "Checking the video length…" : "Applying your edits and creating your loop…");
  const duration = await measureDuration(video);
  if (duration > 30.05) throw new Error("Source video exceeds 30 seconds. Choose a shorter video");
  const prepared = prepareEdits(edits, duration);
  const [x, y, w, h] = prepared.crop;
  const sw = video.videoWidth * w / 100;
  const sh = video.videoHeight * h / 100;
  const rect = {
    sx: video.videoWidth * x / 100,
    sy: video.videoHeight * y / 100,
    sw, sh,
    outW: width,
    outH: Math.max(1, Math.round(sh * width / sw)),
  };
  const count = Math.max(1, Math.ceil(prepared.total * fps - 1e-6));
  if (count * rect.outW * rect.outH > 80_000_000) {
    throw new Error("This loop is too large for the browser. Lower the frame rate or width and try again.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = rect.outW;
  canvas.height = rect.outH;
  const ctx = canvas.getContext("2d", {willReadFrequently: true, alpha: false});
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const keepFrames = count * rect.outW * rect.outH * 4 <= MEMORY_BUDGET;
  const stored = keepFrames ? [] : null;
  const samples = [];
  const state = {seen: 0, stride: Math.max(1, Math.floor(count * rect.outW * rect.outH / 120000))};
  const stamp = index => mapTime(index / fps, prepared.segments);
  for (let index = 0; index < count; index++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    onProgress?.(`Reading frame ${index + 1} of ${count}…`);
    const frame = await grab(video, ctx, stamp(index), rect);
    sampleFrame(frame, samples, state);
    if (stored) stored.push(frame);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  onProgress?.("Encoding your GIF…");
  const encoder = createGifEncoder({width: rect.outW, height: rect.outH, samples, fps, transparent: false, dither: true});
  if (stored) {
    for (const frame of stored) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      encoder.add(frame);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } else {
    for (let index = 0; index < count; index++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      onProgress?.(`Encoding frame ${index + 1} of ${count}…`);
      encoder.add(await grab(video, ctx, stamp(index), rect));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return {blob: encoder.finish(), fps, width: rect.outW, height: rect.outH};
}
