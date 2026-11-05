// Camera input only: enumeration, opening, live preview, and recording.
// GIF output size and frame-rate presets stay in the settings panel.
import {encodeGif} from "./gif-encoder.js";

export const DEFAULT_CAPTURE_IDEAL = {width: 1280, height: 720, frameRate: 30};
export const DIRECT_GIF_SECONDS = 5;
export const MEDIA_RECORDER_LIMIT_MS = 30000;
export const FRAME_PIXEL_BUDGET = 80_000_000;
export const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

const TERMINAL_OPEN_ERRORS = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function cameraSupport({navigator: nav, isSecureContext} = {}) {
  return {
    secure: isSecureContext !== false,
    getUserMedia: typeof resolveGetUserMedia(nav) === "function",
  };
}

export function resolveGetUserMedia(nav) {
  if (!nav) return null;
  const modern = nav.mediaDevices?.getUserMedia;
  if (typeof modern === "function") return modern.bind(nav.mediaDevices);
  const legacy = nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia;
  if (typeof legacy !== "function") return null;
  return constraints => new Promise((resolve, reject) => {
    legacy.call(nav, constraints, resolve, reject);
  });
}

export function cameraErrorMessage(error, context = {}) {
  if (context.secure === false) {
    return "Camera access needs a secure page. Open this studio over HTTPS or localhost, then try again.";
  }
  if (context.getUserMedia === false) {
    return "This browser cannot open a camera. Upload a video instead.";
  }
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access for this site in the browser prompt or site settings, then try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "This camera is busy or the hardware could not be read. Close other apps using it, reconnect it, and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect a webcam, phone, or capture device, then try again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "This camera rejected every requested mode. Choose another camera, or reconnect the capture device and try again.";
    case "SecurityError":
      return "Camera access is blocked because this page is not a secure context. Open it over HTTPS or localhost.";
    case "AbortError":
      return "The browser stopped opening this camera. Try again, or choose a different device.";
    case "NotSupportedError":
      return "This browser cannot open a camera. Upload a video instead.";
    default:
      return error?.message || "Camera access failed. Check the browser permission, or upload a video.";
  }
}

export function normalizeVideoInputs(devices) {
  if (!Array.isArray(devices)) return [];
  const videos = [];
  for (const device of devices) {
    if (!device || device.kind !== "videoinput") continue;
    videos.push({
      deviceId: String(device.deviceId || ""),
      groupId: String(device.groupId || ""),
      label: String(device.label || "").trim(),
    });
  }
  return videos;
}

export async function enumerateVideoInputs(mediaDevices) {
  if (typeof mediaDevices?.enumerateDevices !== "function") return [];
  try {
    return normalizeVideoInputs(await mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}

export function deviceLabel(device, index) {
  const label = String(device?.label || "").trim();
  if (label) return label;
  if (!device?.deviceId) return "Camera (allow access to name it)";
  return `Camera ${index + 1}`;
}

export function deviceOptions(devices, activeDeviceId = "") {
  const options = [];
  const seen = new Set();
  (Array.isArray(devices) ? devices : []).forEach((device, index) => {
    const value = String(device?.deviceId || "");
    if (seen.has(value)) return;
    seen.add(value);
    options.push({
      value,
      label: deviceLabel(device, index),
      unlabeled: !String(device?.label || "").trim(),
    });
  });
  if (!seen.has("")) options.unshift({value: "", label: "System default", unlabeled: false});
  const active = String(activeDeviceId || "");
  if (active && !options.some(option => option.value === active)) {
    options.push({value: active, label: "Active camera", unlabeled: true});
  }
  const selected = options.some(option => option.value === active) ? active : (options[0]?.value ?? "");
  return {options, selected};
}

export function facingControlsVisible(deviceId) {
  return !deviceId;
}

export function bindDeviceChange(target, listener) {
  if (!target || typeof target.addEventListener !== "function" || typeof listener !== "function") return () => {};
  target.addEventListener("devicechange", listener);
  return () => {
    if (typeof target.removeEventListener === "function") target.removeEventListener("devicechange", listener);
  };
}

function addIdeal(target, width, height, frameRate, aspectRatio) {
  if (positive(width)) target.width = {ideal: Math.round(width)};
  if (positive(height)) target.height = {ideal: Math.round(height)};
  if (positive(frameRate)) target.frameRate = {ideal: frameRate};
  if (positive(aspectRatio)) target.aspectRatio = {ideal: aspectRatio};
}

// Exact device + ideals, then bare device, then facing mode, then ideals only, then any camera.
// Resolution hints stay ideal so strict UVC 1.1/1.5 bridges can reject them and still open.
export function constraintAttempts(request = {}) {
  const deviceId = String(request.deviceId || "").trim();
  const facingMode = request.facingMode === "user" || request.facingMode === "environment" ? request.facingMode : "";
  const attempts = [];
  const push = video => {
    const key = JSON.stringify(video);
    if (attempts.some(item => JSON.stringify(item.video) === key)) return;
    attempts.push({audio: false, video});
  };
  const ideal = {};
  addIdeal(ideal, request.width, request.height, request.frameRate, request.aspectRatio);
  if (deviceId) {
    const exact = {deviceId: {exact: deviceId}};
    addIdeal(exact, request.width, request.height, request.frameRate, request.aspectRatio);
    push(exact);
    push({deviceId: {exact: deviceId}});
    push({deviceId});
  }
  if (facingMode) {
    const preferred = {facingMode: {ideal: facingMode}};
    addIdeal(preferred, request.width, request.height, request.frameRate, request.aspectRatio);
    push(preferred);
    push({facingMode});
  }
  if (Object.keys(ideal).length) push(ideal);
  push(true);
  return attempts;
}

export function isTerminalCameraError(error) {
  return TERMINAL_OPEN_ERRORS.has(error?.name);
}

function videoTracks(stream) {
  if (typeof stream?.getVideoTracks === "function") return stream.getVideoTracks();
  if (typeof stream?.getTracks === "function") return stream.getTracks().filter(track => track?.kind === "video");
  return [];
}

export function activeVideoTrack(stream) {
  const tracks = videoTracks(stream);
  return tracks.find(track => track.readyState !== "ended") || tracks[0] || null;
}

export function releaseStream(stream) {
  const tracks = typeof stream?.getTracks === "function" ? stream.getTracks() : [];
  for (const track of tracks) {
    try { track.stop(); } catch { /* The track may already be stopped. */ }
  }
  return tracks.length;
}

export async function openCamera(getUserMedia, request = {}) {
  if (typeof getUserMedia !== "function") {
    const error = new Error("This browser cannot open a camera.");
    error.name = "NotSupportedError";
    throw error;
  }
  const attempts = constraintAttempts(request);
  let lastError;
  for (const constraints of attempts) {
    try {
      const stream = await getUserMedia(constraints);
      const live = videoTracks(stream).some(track => track.readyState !== "ended");
      if (!live) {
        releaseStream(stream);
        lastError = new DOMException("No video track", "NotFoundError");
        continue;
      }
      return {stream, constraints};
    } catch (error) {
      lastError = error;
      if (isTerminalCameraError(error)) break;
    }
  }
  throw lastError || new DOMException("No camera was found", "NotFoundError");
}

export const CAMERA_CLASS_GROUPS = {
  continuity: "phone",
  "device-as-webcam": "phone",
  "mobile-browser": "phone",
  "legacy-webcam-utility": "uvc",
  "native-uvc": "uvc",
  "capture-card": "capture",
  "action-gimbal": "action",
  cinema: "cinema",
  virtual: "virtual",
  builtin: "builtin",
  unknown: "unknown",
};

const CAMERA_LABEL_RULES = [
  [/(\bobs\b|manycam|snap camera|mmhmm|virtual camera)/i, "virtual"],
  [/(elgato|cam link|magewell|usb capture|hdmi capture|capture card|atomos|decklink|ultrastudio|web presenter|video assist)/i, "capture-card"],
  [/(gopro|\bdji\b|\bosmo\b|ronin|insta360)/i, "action-gimbal"],
  [/(blackmagic|\barri\b|alexa|\bred\b|komodo|v-raptor|venice|burano|varicam)/i, "cinema"],
  [/(continuity|\biphone\b|\bipad\b)/i, "continuity"],
  [/(device\s*as\s*webcam|\bpixel\b|\bgalaxy\b|\bandroid\b|xperia|xiaomi)/i, "device-as-webcam"],
  [/(imaging edge|eos webcam|webcam utility)/i, "legacy-webcam-utility"],
  [/(\bnikon\b|fujifilm|\bfuji\b|\blumix\b|\bpanasonic\b|\bcanon\b|\bsony\b)/i, "native-uvc"],
  [/(front camera|back camera|ultra wide|telephoto|camera2|facing back|facing front)/i, "mobile-browser"],
  [/(facetime|built-in|integrated webcam|hd webcam|usb camera|\bwebcam\b)/i, "builtin"],
];

function pair(width, height) {
  const w = Math.round(positive(width));
  const h = Math.round(positive(height));
  return w && h ? {width: w, height: h} : {width: 0, height: 0};
}

function samePair(left, right) {
  return left.width === right.width && left.height === right.height;
}

export function classifyCamera({label = "", width = 0, height = 0, facingMode = ""} = {}) {
  const text = String(label || "").trim();
  let id = "";
  for (const [pattern, classId] of CAMERA_LABEL_RULES) {
    if (pattern.test(text)) {
      id = classId;
      break;
    }
  }
  const size = pair(width, height);
  if (!id && (samePair(size, {width: 1024, height: 576}) || samePair(size, {width: 1088, height: 576}) || samePair(size, {width: 1024, height: 768}))) {
    id = "legacy-webcam-utility";
  } else if (!id && samePair(size, {width: 1920, height: 1440})) {
    id = "continuity";
  } else if (!id && (facingMode === "user" || facingMode === "environment")) {
    id = "mobile-browser";
  } else if (!id && [ [640, 480], [1280, 720], [1920, 1080] ].some(([w, h]) => samePair(size, {width: w, height: h}))) {
    id = "builtin";
  }
  if (!id) id = "unknown";
  return {id, group: CAMERA_CLASS_GROUPS[id] || "unknown", label: text};
}

function capabilityRange(value) {
  if (!value || typeof value !== "object") return null;
  const min = positive(value.min);
  const max = positive(value.max);
  if (!min && !max) return null;
  return {min: min || 0, max: max || 0};
}

export function readTrackCapabilities(track) {
  if (typeof track?.getCapabilities !== "function") return null;
  try {
    const caps = track.getCapabilities() || {};
    const facingMode = Array.isArray(caps.facingMode)
      ? caps.facingMode.filter(mode => mode === "user" || mode === "environment")
      : [];
    return {
      width: capabilityRange(caps.width),
      height: capabilityRange(caps.height),
      frameRate: capabilityRange(caps.frameRate),
      aspectRatio: capabilityRange(caps.aspectRatio),
      facingMode,
      deviceId: String(caps.deviceId || ""),
    };
  } catch {
    return null;
  }
}

export function chooseLiveSize({videoWidth = 0, videoHeight = 0, settingsWidth = 0, settingsHeight = 0, previous} = {}) {
  const video = pair(videoWidth, videoHeight);
  const settings = pair(settingsWidth, settingsHeight);
  const previousVideo = pair(previous?.videoWidth, previous?.videoHeight);
  const previousSettings = pair(previous?.settingsWidth, previous?.settingsHeight);
  const videoChanged = previous ? !samePair(video, previousVideo) : false;
  const settingsChanged = previous ? !samePair(settings, previousSettings) : false;
  let source = "none";
  if (settingsChanged && !videoChanged && settings.width) source = "settings";
  else if (video.width) source = "video";
  else if (settings.width) source = "settings";
  const chosen = source === "settings" ? settings : video.width ? video : settings;
  return {
    width: chosen.width || 0,
    height: chosen.height || 0,
    source: chosen.width ? source : "none",
    videoWidth: video.width,
    videoHeight: video.height,
    settingsWidth: settings.width,
    settingsHeight: settings.height,
  };
}

export function readLiveVideoMetadata(video, track, previous) {
  const settings = typeof track?.getSettings === "function" ? (track.getSettings() || {}) : {};
  const facingMode = settings.facingMode === "user" || settings.facingMode === "environment" ? settings.facingMode : "";
  const frameRate = positive(settings.frameRate);
  const chosen = chooseLiveSize({
    videoWidth: video?.videoWidth,
    videoHeight: video?.videoHeight,
    settingsWidth: settings.width,
    settingsHeight: settings.height,
    previous,
  });
  const label = String(track?.label || "").trim();
  const deviceClass = classifyCamera({label, width: chosen.width, height: chosen.height, facingMode});
  return {
    label,
    deviceId: String(settings.deviceId || ""),
    width: chosen.width,
    height: chosen.height,
    frameRate: frameRate || null,
    facingMode,
    videoWidth: chosen.videoWidth,
    videoHeight: chosen.videoHeight,
    settingsWidth: chosen.settingsWidth,
    settingsHeight: chosen.settingsHeight,
    sizeSource: chosen.source,
    deviceClass: deviceClass.id,
    deviceGroup: deviceClass.group,
    capabilities: readTrackCapabilities(track),
  };
}

export function resolveCameraLabel(meta, devices = []) {
  const trackLabel = String(meta?.label || "").trim();
  if (trackLabel) return trackLabel;
  const deviceId = String(meta?.deviceId || "");
  const match = (devices || []).find(device => device.deviceId && device.deviceId === deviceId);
  return match?.label || "Camera";
}

export function formatFrameRate(frameRate) {
  const rate = positive(frameRate);
  return rate ? String(Math.round(rate * 100) / 100) : "";
}

export function formatCameraStatus(meta) {
  const label = meta?.label || "Camera";
  if (!meta?.width || !meta?.height) return `${label} · waiting for video`;
  const fps = meta.frameRate ? ` · ${formatFrameRate(meta.frameRate)} fps` : "";
  return `${label} · ${meta.width}×${meta.height}${fps}`;
}

export function watchLiveVideo(video, getTrack, onChange, environment = {}) {
  if (!video || typeof video.addEventListener !== "function" || typeof onChange !== "function") return () => {};
  let lastKey = "";
  let lastSize = "";
  let previous = null;
  let frameHandle = 0;
  let stopped = false;
  const orientation = environment.orientation || (typeof screen !== "undefined" ? screen.orientation : undefined);
  const publish = reason => {
    const track = typeof getTrack === "function" ? getTrack() : getTrack;
    const meta = readLiveVideoMetadata(video, track, previous);
    previous = meta;
    const key = JSON.stringify(meta);
    if (key === lastKey) return;
    const size = `${meta.width}x${meta.height}`;
    const changedSize = Boolean(lastSize && lastSize !== "0x0" && size !== "0x0" && size !== lastSize);
    lastKey = key;
    lastSize = size;
    if (typeof video.dispatchEvent === "function") {
      video.dispatchEvent(new CustomEvent("gifmaker-live-video", {detail: meta}));
    }
    onChange(meta, {reason, changedSize});
  };
  const onLoaded = () => publish("loadedmetadata");
  const onResize = () => publish("resize");
  const onOrient = () => publish("orientation");
  const onFrame = () => {
    if (stopped) return;
    publish("frame");
    if (!stopped && typeof video.requestVideoFrameCallback === "function") {
      frameHandle = video.requestVideoFrameCallback(onFrame);
    }
  };
  video.addEventListener("loadedmetadata", onLoaded);
  video.addEventListener("resize", onResize);
  orientation?.addEventListener?.("change", onOrient);
  if (typeof video.requestVideoFrameCallback === "function") frameHandle = video.requestVideoFrameCallback(onFrame);
  publish("attach");
  return () => {
    stopped = true;
    video.removeEventListener("loadedmetadata", onLoaded);
    video.removeEventListener("resize", onResize);
    orientation?.removeEventListener?.("change", onOrient);
    if (frameHandle && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(frameHandle);
  };
}

export function chooseRecorderMime(isTypeSupported, candidates = RECORDER_MIME_CANDIDATES) {
  if (typeof isTypeSupported !== "function") return "";
  for (const mime of candidates) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Some browsers throw while probing a codec. Try the next one.
    }
  }
  return "";
}

export function recorderMimeAttempts(isTypeSupported, candidates) {
  const chosen = chooseRecorderMime(isTypeSupported, candidates);
  return chosen ? [chosen, ""] : [""];
}

export function recordingExtension(mimeType) {
  return String(mimeType || "").toLowerCase().includes("mp4") ? "mp4" : "webm";
}

export function recordingFilename(mimeType) {
  return `camera.${recordingExtension(mimeType)}`;
}

export function openRecorder({MediaRecorder, stream, isTypeSupported} = {}) {
  if (typeof MediaRecorder !== "function") return {ok: false, reason: "unavailable"};
  const probe = isTypeSupported || (typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : null);
  const attempts = recorderMimeAttempts(probe);
  let lastError;
  for (const mimeType of attempts) {
    try {
      const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
      return {ok: true, recorder, mimeType: recorder?.mimeType || mimeType || ""};
    } catch (error) {
      lastError = error;
    }
  }
  return {ok: false, reason: "failed", error: lastError};
}

export function startRecorder(recorder, timeslice = 250) {
  try {
    recorder.start(timeslice);
    return timeslice;
  } catch (error) {
    try {
      recorder.start();
      return 0;
    } catch {
      throw error;
    }
  }
}

export function normalizeFps(value) {
  const fps = Number(value);
  return Number.isInteger(fps) && fps >= 1 && fps <= 30 ? fps : 10;
}

export function normalizeGifWidth(value) {
  const width = Number(value);
  return Number.isInteger(width) && width >= 100 && width <= 800 ? width : 320;
}

export function fitFrame(sourceWidth, sourceHeight, targetWidth) {
  const width = normalizeGifWidth(targetWidth);
  const sw = positive(sourceWidth);
  const sh = positive(sourceHeight);
  if (!sw || !sh) return {width, height: 0};
  return {width, height: Math.max(1, Math.round(sh * width / sw))};
}

export function directCapturePlan({fps, gifWidth, videoWidth, videoHeight} = {}) {
  const rate = normalizeFps(fps);
  const frame = fitFrame(videoWidth, videoHeight, gifWidth);
  const maxFrames = rate * DIRECT_GIF_SECONDS;
  const pixels = frame.height ? frame.width * frame.height * maxFrames : 0;
  return {
    fps: rate,
    width: frame.width,
    height: frame.height,
    maxFrames,
    intervalMs: Math.max(1, Math.round(1000 / rate)),
    pixels,
    tooLarge: pixels > FRAME_PIXEL_BUDGET,
  };
}

export function samplePreviewFrame(video, canvas, context, targetWidth, lockedHeight = 0) {
  if (!positive(video?.videoWidth) || !positive(video?.videoHeight) || !canvas || !context) return null;
  const fitted = fitFrame(video.videoWidth, video.videoHeight, targetWidth);
  const width = fitted.width;
  const height = lockedHeight > 0 ? Math.round(lockedHeight) : fitted.height;
  if (!width || !height) return null;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  if (!image?.data?.length) return null;
  return image;
}

export function createFrameGrabber({readFrame, intervalMs, maxFrames, schedule = setInterval, cancel = clearInterval} = {}) {
  const frames = [];
  let timer = null;
  let running = false;
  const stop = () => {
    running = false;
    if (timer != null) cancel(timer);
    timer = null;
    return frames;
  };
  return {
    get running() { return running; },
    get frames() { return frames; },
    start() {
      if (running) return;
      running = true;
      timer = schedule(() => {
        if (!running || frames.length >= maxFrames) return;
        try {
          const frame = readFrame?.();
          if (frame) frames.push(frame);
        } catch {
          // Skip a frame the camera could not draw.
        }
      }, intervalMs);
    },
    stop,
  };
}

export async function encodeCameraFrames(frames, {fps} = {}) {
  if (!frames?.length) throw new Error("No frames were captured from this camera.");
  const width = frames[0].width;
  const height = frames[0].height;
  if (!width || !height || frames.some(frame => frame.width !== width || frame.height !== height)) {
    throw new Error("The camera changed size while recording. Try the recording again.");
  }
  if (frames.length * width * height > FRAME_PIXEL_BUDGET) {
    throw new Error("This live capture is too large for a GIF. Lower the frame rate or width and try again.");
  }
  return encodeGif(frames, {
    fps: normalizeFps(fps),
    dither: true,
    transparent: false,
    tick: () => new Promise(resolve => setTimeout(resolve, 0)),
  });
}
