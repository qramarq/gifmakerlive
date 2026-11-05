import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_CLASS_GROUPS,
  DEFAULT_CAPTURE_IDEAL,
  bindDeviceChange,
  cameraErrorMessage,
  cameraSupport,
  chooseLiveSize,
  chooseRecorderMime,
  classifyCamera,
  constraintAttempts,
  createFrameGrabber,
  deviceOptions,
  directCapturePlan,
  encodeCameraFrames,
  enumerateVideoInputs,
  facingControlsVisible,
  formatCameraStatus,
  normalizeVideoInputs,
  openCamera,
  openRecorder,
  readLiveVideoMetadata,
  recordingFilename,
  recorderMimeAttempts,
  releaseStream,
  resolveCameraLabel,
  resolveGetUserMedia,
  samplePreviewFrame,
  startRecorder,
  watchLiveVideo,
} from "../web/camera.js";

function fail(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function streamFrom(tracks) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(track => track.kind === "video"),
  };
}

function liveTrack(extra = {}) {
  return {
    kind: "video",
    readyState: "live",
    label: extra.label || "",
    stop() { this.readyState = "ended"; },
    getSettings: () => extra.settings || {},
    getCapabilities: extra.capabilities ? () => extra.capabilities : undefined,
  };
}

test("enumeration keeps every video input and drops other kinds", () => {
  const devices = normalizeVideoInputs([
    null,
    {kind: "audioinput", deviceId: "mic", label: "Mic"},
    {kind: "videoinput", deviceId: "built-in", label: "  Built-in Webcam  ", groupId: "g1"},
    {kind: "videoinput", deviceId: "", label: "", groupId: "pending"},
    {kind: "videoinput", deviceId: "obs", label: "OBS Virtual Camera", groupId: "g2"},
    {kind: "videoinput", deviceId: "hdmi", label: "", groupId: "g3"},
  ]);
  assert.deepEqual(devices.map(device => device.deviceId), ["built-in", "", "obs", "hdmi"]);
  assert.equal(devices[0].label, "Built-in Webcam");
  const pending = deviceOptions([{deviceId: "", label: ""}], "");
  assert.equal(pending.options.length, 1);
  assert.match(pending.options[0].label, /allow access/);
  const named = deviceOptions([
    {deviceId: "built-in", label: ""},
    {deviceId: "obs", label: "OBS Virtual Camera"},
  ], "obs");
  assert.equal(named.options.find(option => option.value === "built-in").label, "Camera 1");
  assert.equal(named.selected, "obs");
  assert.equal(named.options[0].label, "System default");
  const hot = deviceOptions([
    {deviceId: "built-in", label: "Built-in Webcam"},
    {deviceId: "obs", label: "OBS Virtual Camera"},
    {deviceId: "scope", label: "Lab Microscope"},
  ], "obs");
  assert.equal(hot.selected, "obs");
  assert.ok(hot.options.some(option => option.label === "Lab Microscope"));
  assert.equal(facingControlsVisible(""), true);
  assert.equal(facingControlsVisible("obs"), false);
});

test("devicechange subscription refreshes listeners and can be removed", () => {
  const target = new EventTarget();
  let calls = 0;
  const unbind = bindDeviceChange(target, () => { calls += 1; });
  target.dispatchEvent(new Event("devicechange"));
  unbind();
  target.dispatchEvent(new Event("devicechange"));
  assert.equal(calls, 1);
  assert.equal(typeof bindDeviceChange(null, () => {}), "function");
});

test("enumerateVideoInputs survives a missing or failing device list", async () => {
  assert.deepEqual(await enumerateVideoInputs(undefined), []);
  assert.deepEqual(await enumerateVideoInputs({enumerateDevices: async () => { throw fail("SecurityError"); }}), []);
  const listed = await enumerateVideoInputs({
    enumerateDevices: async () => [{kind: "videoinput", deviceId: "cam", label: "Continuity Camera"}],
  });
  assert.equal(listed[0].label, "Continuity Camera");
});

test("getUserMedia falls back from ideal and exact constraints", async () => {
  const seen = [];
  let stopped = 0;
  const opened = await openCamera(async constraints => {
    seen.push(constraints);
    if (seen.length < 3 || seen.length === 4) throw fail(seen.length === 2 ? "NotReadableError" : "OverconstrainedError");
    if (seen.length === 3) return streamFrom([{kind: "audio", readyState: "live", stop() { stopped += 1; }}]);
    return streamFrom([liveTrack({settings: {deviceId: "uvc"}})]);
  }, {deviceId: "uvc", ...DEFAULT_CAPTURE_IDEAL});
  assert.deepEqual(seen.map(constraints => constraints.video), [
    {deviceId: {exact: "uvc"}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}},
    {deviceId: {exact: "uvc"}},
    {deviceId: "uvc"},
    {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}},
    true,
  ]);
  assert.equal(stopped, 1);
  assert.equal(opened.constraints.video, true);
  assert.equal(opened.stream.getVideoTracks()[0].getSettings().deviceId, "uvc");
});

test("facing mode is requested as an ideal and then dropped", async () => {
  const seen = [];
  await openCamera(async constraints => {
    seen.push(constraints.video);
    if (seen.length === 1) throw fail("OverconstrainedError");
    return streamFrom([liveTrack()]);
  }, {facingMode: "environment", width: 640, height: 480});
  assert.deepEqual(seen, [
    {facingMode: {ideal: "environment"}, width: {ideal: 640}, height: {ideal: 480}},
    {facingMode: "environment"},
  ]);
});

test("permission and security errors stop the fallback ladder", async () => {
  let calls = 0;
  await assert.rejects(
    () => openCamera(async () => {
      calls += 1;
      throw fail("NotAllowedError");
    }, {deviceId: "cam", ...DEFAULT_CAPTURE_IDEAL}),
    error => error.name === "NotAllowedError",
  );
  assert.equal(calls, 1);
  assert.match(cameraErrorMessage(fail("NotAllowedError")), /permission was denied/i);
  assert.match(cameraErrorMessage(fail("NotReadableError")), /busy or the hardware/i);
  assert.match(cameraErrorMessage(fail("NotFoundError")), /No camera was found/);
  assert.match(cameraErrorMessage(fail("OverconstrainedError")), /rejected every requested mode/);
  assert.match(cameraErrorMessage(fail("SecurityError")), /secure context/);
  assert.match(cameraErrorMessage(null, {secure: false}), /secure page/);
  assert.match(cameraErrorMessage(null, {getUserMedia: false}), /cannot open a camera/);
  assert.equal(cameraSupport({isSecureContext: false, navigator: {mediaDevices: {getUserMedia() {}}}}).secure, false);
  assert.equal(cameraSupport({isSecureContext: true, navigator: {}}).getUserMedia, false);
});

test("legacy getUserMedia callback APIs are adapted", async () => {
  const nav = {
    webkitGetUserMedia(constraints, ok) { ok(streamFrom([liveTrack()])); },
  };
  const getUserMedia = resolveGetUserMedia(nav);
  const stream = await getUserMedia({video: true, audio: false});
  assert.equal(stream.getVideoTracks()[0].readyState, "live");
  assert.equal(resolveGetUserMedia({}), null);
});

test("a bare device request still reaches an unconstrained video stream", () => {
  assert.deepEqual(constraintAttempts({}), [{audio: false, video: true}]);
  assert.deepEqual(constraintAttempts({deviceId: "cam"}).map(item => item.video), [
    {deviceId: {exact: "cam"}},
    {deviceId: "cam"},
    true,
  ]);
  const ladder = constraintAttempts({
    deviceId: "uvc",
    facingMode: "environment",
    width: 1280,
    height: 720,
    frameRate: 30,
    aspectRatio: 1.7778,
  }).map(item => item.video);
  assert.deepEqual(ladder, [
    {deviceId: {exact: "uvc"}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}, aspectRatio: {ideal: 1.7778}},
    {deviceId: {exact: "uvc"}},
    {deviceId: "uvc"},
    {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}, aspectRatio: {ideal: 1.7778}},
    {facingMode: "environment"},
    {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}, aspectRatio: {ideal: 1.7778}},
    true,
  ]);
  for (const video of ladder) {
    if (video === true) continue;
    assert.equal(Boolean(video.deviceId && video.facingMode), false);
    for (const key of ["width", "height", "frameRate", "aspectRatio"]) {
      if (video[key]) assert.deepEqual(Object.keys(video[key]), ["ideal"]);
    }
  }
});

test("live metadata follows loadedmetadata and resize, then stops", () => {
  const video = new EventTarget();
  video.videoWidth = 0;
  video.videoHeight = 0;
  const track = liveTrack({
    label: "DeckLink SDI",
    settings: {deviceId: "sdi", width: 720, height: 576, frameRate: 25, facingMode: "environment"},
  });
  const events = [];
  const stop = watchLiveVideo(video, () => track, (meta, info) => events.push({meta, info}));
  assert.equal(events.length, 1);
  assert.equal(events[0].meta.width, 720);
  assert.equal(events[0].meta.height, 576);
  assert.equal(events[0].meta.frameRate, 25);
  assert.equal(events[0].info.reason, "attach");
  assert.equal(events[0].info.changedSize, false);
  video.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(events.length, 1);
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.dispatchEvent(new Event("resize"));
  assert.equal(events.length, 2);
  assert.equal(events[1].meta.width, 1920);
  assert.equal(events[1].meta.height, 1080);
  assert.equal(events[1].info.reason, "resize");
  assert.equal(events[1].info.changedSize, true);
  assert.equal(formatCameraStatus({...events[1].meta, label: events[1].meta.label}), "DeckLink SDI · 1920×1080 · 25 fps");
  video.dispatchEvent(new Event("resize"));
  assert.equal(events.length, 2);
  stop();
  video.videoWidth = 640;
  video.videoHeight = 480;
  video.dispatchEvent(new Event("resize"));
  assert.equal(events.length, 2);
  const unnamed = readLiveVideoMetadata({videoWidth: 0, videoHeight: 0}, liveTrack({settings: {deviceId: "hdmi"}}));
  assert.equal(resolveCameraLabel(unnamed, [{deviceId: "hdmi", label: "HDMI Capture Card"}]), "HDMI Capture Card");
});

test("MediaRecorder negotiation prefers vp9, then vp8, mp4, and a default constructor", () => {
  assert.equal(chooseRecorderMime(type => type === "video/webm;codecs=vp9"), "video/webm;codecs=vp9");
  assert.equal(chooseRecorderMime(type => type === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(chooseRecorderMime(type => type === "video/mp4"), "video/mp4");
  assert.deepEqual(recorderMimeAttempts(() => false), [""]);
  assert.equal(chooseRecorderMime(type => {
    if (type.includes("vp9")) throw new Error("probe failed");
    return type === "video/webm;codecs=vp8";
  }), "video/webm;codecs=vp8");
  assert.equal(recordingFilename("video/mp4;codecs=avc1.42E01E"), "camera.mp4");
  assert.equal(recordingFilename(""), "camera.webm");

  const constructed = [];
  class FakeRecorder {
    constructor(_stream, options) {
      constructed.push(options || null);
      if (options?.mimeType === "video/mp4") throw new Error("picky container");
      this.mimeType = options?.mimeType || "";
    }
  }
  const failed = openRecorder({
    MediaRecorder: FakeRecorder,
    stream: {},
    isTypeSupported: type => type === "video/mp4",
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.mimeType, "");
  assert.deepEqual(constructed, [{mimeType: "video/mp4"}, null]);
  assert.deepEqual(openRecorder({stream: {}}), {ok: false, reason: "unavailable"});

  const started = [];
  assert.equal(startRecorder({
    start(timeslice) {
      started.push(timeslice);
      if (arguments.length) throw new Error("timeslice unsupported");
    },
  }, 250), 0);
  assert.deepEqual(started, [250, undefined]);
  assert.throws(() => startRecorder({start() { throw new Error("no recorder"); }}), /no recorder/);
});

test("direct frame capture scales the preview and encodes a looping GIF", async () => {
  const video = {videoWidth: 160, videoHeight: 90};
  const canvas = {width: 0, height: 0};
  const context = {
    drawImage(_video, _x, _y, width, height) { this.size = {width, height}; },
    getImageData(_x, _y, width, height) {
      return {width, height, data: new Uint8ClampedArray(width * height * 4).fill(255)};
    },
  };
  const frame = samplePreviewFrame(video, canvas, context, 320);
  assert.equal(frame.width, 320);
  assert.equal(frame.height, 180);
  assert.equal(samplePreviewFrame({videoWidth: 0, videoHeight: 0}, canvas, context, 320), null);

  let tick;
  const grabber = createFrameGrabber({
    readFrame: () => frame,
    intervalMs: 10,
    maxFrames: 2,
    schedule(fn) { tick = fn; return 1; },
    cancel() { tick = null; },
  });
  grabber.start();
  tick(); tick(); tick();
  assert.equal(grabber.stop().length, 2);
  assert.equal(tick, null);

  const plan = directCapturePlan({fps: 10, gifWidth: 320, videoWidth: 160, videoHeight: 90});
  assert.equal(plan.maxFrames, 50);
  assert.equal(plan.tooLarge, false);
  const huge = directCapturePlan({fps: 30, gifWidth: 800, videoWidth: 100, videoHeight: 20000});
  assert.equal(huge.tooLarge, true);

  const blob = await encodeCameraFrames([frame, frame], {fps: 10});
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 6).toString(), "GIF89a");
  assert.ok(bytes.includes(Buffer.from("NETSCAPE2.0")));
  await assert.rejects(() => encodeCameraFrames([], {fps: 10}), /No frames/);
  await assert.rejects(() => encodeCameraFrames([frame, {width: 1, height: 1, data: new Uint8ClampedArray(4)}], {fps: 10}), /changed size/);
});

test("UVC bridges, phone webcams, and live size follow the technical reference", async () => {
  const classes = [
    ["Continuity Camera", 1920, 1440, "continuity", "phone"],
    ["Marq's iPhone", 1920, 1080, "continuity", "phone"],
    ["Pixel 9", 3840, 2160, "device-as-webcam", "phone"],
    ["Samsung Galaxy S26 Ultra", 1920, 1080, "device-as-webcam", "phone"],
    ["Front Camera", 1080, 1920, "mobile-browser", "phone"],
    ["camera2 0, facing back", 1920, 1080, "mobile-browser", "phone"],
    ["Back Ultra Wide Camera", 1920, 1080, "mobile-browser", "phone"],
    ["Imaging Edge Webcam", 1024, 576, "legacy-webcam-utility", "uvc"],
    ["EOS Webcam Utility", 1024, 576, "legacy-webcam-utility", "uvc"],
    ["Nikon Webcam Utility", 1024, 768, "legacy-webcam-utility", "uvc"],
    ["Nikon Z 9", 1920, 1080, "native-uvc", "uvc"],
    ["Canon EOS R5", 1920, 1080, "native-uvc", "uvc"],
    ["Fujifilm X-H2S", 1920, 1080, "native-uvc", "uvc"],
    ["Lumix S5II", 1280, 720, "native-uvc", "uvc"],
    ["Sony FX3", 1920, 1080, "native-uvc", "uvc"],
    ["Elgato Cam Link 4K", 3840, 2160, "capture-card", "capture"],
    ["Magewell USB Capture HDMI 4K", 4096, 2160, "capture-card", "capture"],
    ["Blackmagic Web Presenter", 1920, 1080, "capture-card", "capture"],
    ["Atomos Connect", 1920, 1080, "capture-card", "capture"],
    ["GoPro Webcam", 1920, 1080, "action-gimbal", "action"],
    ["DJI Osmo Pocket 3", 1920, 1080, "action-gimbal", "action"],
    ["Insta360 Link", 1920, 1080, "action-gimbal", "action"],
    ["Blackmagic Pocket Cinema Camera", 1920, 1080, "cinema", "cinema"],
    ["OBS Virtual Camera", 1920, 1080, "virtual", "virtual"],
    ["FaceTime HD Camera", 1280, 720, "builtin", "builtin"],
    ["", 1024, 576, "legacy-webcam-utility", "uvc"],
    ["", 1920, 1440, "continuity", "phone"],
  ];
  for (const [label, width, height, id, group] of classes) {
    const found = classifyCamera({label, width, height});
    assert.equal(found.id, id, label || `${width}x${height}`);
    assert.equal(found.group, group, label || `${width}x${height}`);
    assert.equal(CAMERA_CLASS_GROUPS[id], group);
  }

  const legacy = await openCamera(async constraints => {
    const video = constraints.video;
    if (video && video !== true && (video.width || video.height || video.frameRate || video.facingMode)) throw fail("OverconstrainedError");
    return streamFrom([liveTrack({
      label: "Imaging Edge Webcam",
      settings: {deviceId: "sony", width: 1024, height: 576, frameRate: 30},
    })]);
  }, {deviceId: "sony", ...DEFAULT_CAPTURE_IDEAL});
  assert.deepEqual(legacy.constraints.video, {deviceId: {exact: "sony"}});
  const legacyMeta = readLiveVideoMetadata({videoWidth: 1024, videoHeight: 576}, legacy.stream.getVideoTracks()[0]);
  assert.equal(legacyMeta.width, 1024);
  assert.equal(legacyMeta.height, 576);
  assert.equal(legacyMeta.deviceClass, "legacy-webcam-utility");

  const seen = [];
  const card = await openCamera(async constraints => {
    seen.push(constraints.video);
    const video = constraints.video;
    if (video && video !== true && (video.facingMode || video.width || video.height)) throw fail("OverconstrainedError");
    return streamFrom([liveTrack({
      label: "Elgato Cam Link 4K",
      settings: {deviceId: "elgato", width: 3840, height: 2160, frameRate: 30},
      capabilities: {width: {min: 640, max: 3840}, height: {min: 480, max: 2160}, frameRate: {max: 60}, facingMode: ["user"]},
    })]);
  }, {facingMode: "environment", ...DEFAULT_CAPTURE_IDEAL});
  assert.deepEqual(seen, [
    {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}},
    {facingMode: "environment"},
    {width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}},
    true,
  ]);
  const cardTrack = card.stream.getVideoTracks()[0];
  const cardMeta = readLiveVideoMetadata({videoWidth: 0, videoHeight: 0}, cardTrack);
  assert.equal(cardMeta.width, 3840);
  assert.equal(cardMeta.height, 2160);
  assert.equal(cardMeta.sizeSource, "settings");
  assert.equal(cardMeta.deviceClass, "capture-card");
  assert.deepEqual(cardMeta.capabilities.width, {min: 640, max: 3840});
  assert.deepEqual(cardMeta.capabilities.facingMode, ["user"]);

  const continuity = await openCamera(async constraints => {
    const video = constraints.video;
    if (video && video !== true && (video.width?.ideal >= 3840 || video.height?.ideal >= 2160)) throw fail("OverconstrainedError");
    const portrait = video && video !== true && video.height?.ideal === 1440;
    return streamFrom([liveTrack({
      label: "Continuity Camera",
      settings: {deviceId: "iphone", width: portrait ? 1920 : 1920, height: portrait ? 1440 : 1080, frameRate: 30},
    })]);
  }, {deviceId: "iphone", width: 3840, height: 2160, frameRate: 30});
  assert.equal(continuity.constraints.video.width, undefined);
  const phone = readLiveVideoMetadata({videoWidth: 1920, videoHeight: 1440}, continuity.stream.getVideoTracks()[0]);
  assert.equal(phone.deviceClass, "continuity");
  assert.equal(phone.width, 1920);
  assert.equal(phone.height, 1440);
  assert.equal(phone.sizeSource, "video");

  const delivered = chooseLiveSize({videoWidth: 1920, videoHeight: 1440, settingsWidth: 1280, settingsHeight: 720});
  assert.equal(delivered.source, "video");
  assert.deepEqual([delivered.width, delivered.height], [1920, 1440]);
  const switched = chooseLiveSize({
    videoWidth: 1920, videoHeight: 1440, settingsWidth: 3840, settingsHeight: 2160, previous: delivered,
  });
  assert.equal(switched.source, "settings");
  assert.deepEqual([switched.width, switched.height], [3840, 2160]);
  const rotated = chooseLiveSize({
    videoWidth: 1440, videoHeight: 1920, settingsWidth: 3840, settingsHeight: 2160, previous: switched,
  });
  assert.equal(rotated.source, "video");
  assert.deepEqual([rotated.width, rotated.height], [1440, 1920]);

  const video = new EventTarget();
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  let frame = null;
  let cancelled = 0;
  video.requestVideoFrameCallback = callback => { frame = callback; return 4; };
  video.cancelVideoFrameCallback = () => { cancelled += 1; };
  const orientation = new EventTarget();
  const events = [];
  const track = liveTrack({label: "Pixel 9", settings: {deviceId: "pixel", width: 1920, height: 1080, frameRate: 30}});
  const stop = watchLiveVideo(video, () => track, (meta, info) => events.push({meta, info}), {orientation});
  assert.equal(events.at(-1).meta.deviceClass, "device-as-webcam");
  assert.equal(events.at(-1).info.reason, "attach");
  frame();
  assert.equal(events.at(-1).info.reason, "attach");
  track.getSettings = () => ({deviceId: "pixel", width: 3840, height: 2160, frameRate: 30});
  frame();
  assert.equal(events.at(-1).info.reason, "frame");
  assert.equal(events.at(-1).meta.width, 3840);
  assert.equal(events.at(-1).meta.sizeSource, "settings");
  video.videoWidth = 2160;
  video.videoHeight = 3840;
  orientation.dispatchEvent(new Event("change"));
  assert.equal(events.at(-1).info.reason, "orientation");
  assert.equal(events.at(-1).meta.width, 2160);
  assert.equal(events.at(-1).meta.height, 3840);
  assert.equal(events.at(-1).meta.sizeSource, "video");
  stop();
  assert.equal(cancelled, 1);
});

test("releaseStream stops every track even when one stop throws", () => {
  const tracks = [
    {stop() { this.stopped = true; }},
    {stop() { throw new Error("already ended"); }},
  ];
  assert.equal(releaseStream(streamFrom(tracks)), 2);
  assert.equal(tracks[0].stopped, true);
  assert.equal(releaseStream(null), 0);
});
