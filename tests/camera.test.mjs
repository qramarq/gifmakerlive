import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CAPTURE_IDEAL,
  bindDeviceChange,
  cameraErrorMessage,
  cameraSupport,
  chooseRecorderMime,
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
    if (seen.length < 3) throw fail(seen.length === 2 ? "NotReadableError" : "OverconstrainedError");
    if (seen.length === 3) return streamFrom([{kind: "audio", readyState: "live", stop() { stopped += 1; }}]);
    return streamFrom([liveTrack({settings: {deviceId: "uvc"}})]);
  }, {deviceId: "uvc", ...DEFAULT_CAPTURE_IDEAL});
  assert.deepEqual(seen.map(constraints => constraints.video), [
    {deviceId: {exact: "uvc"}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}},
    {deviceId: {exact: "uvc"}},
    {deviceId: "uvc"},
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

test("releaseStream stops every track even when one stop throws", () => {
  const tracks = [
    {stop() { this.stopped = true; }},
    {stop() { throw new Error("already ended"); }},
  ];
  assert.equal(releaseStream(streamFrom(tracks)), 2);
  assert.equal(tracks[0].stopped, true);
  assert.equal(releaseStream(null), 0);
});
