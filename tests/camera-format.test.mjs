import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createGifEncoder} from "../web/gif-encoder.js";
import {
  PROFILES,
  assertLoopBudget,
  cameraModes,
  chooseLiveSize,
  constraintsForMode,
  describeCamera,
  detectCameraFormat,
  formatReadout,
  heightForAspect,
  liveMatchSize,
  orientSource,
  outputDimensions,
  placeSource,
} from "../web/camera-format.js";

const full = [0, 0, 100, 100];

test("studio surfaces list every camera profile", () => {
  const files = ["web/index.html", "crates/studio/src/lib.rs", "crates/gif-core/src/camera.rs"];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const id of Object.keys(PROFILES)) {
      assert.ok(text.includes(id), `${file} is missing ${id}`);
    }
  }
  assert.equal(Object.keys(PROFILES).length, 21);
});

test("detects smartphone orientation, lens, and facing", () => {
  const front = detectCameraFormat({width: 1080, height: 1920, facingMode: "user", label: "Front Ultra Wide Camera"});
  assert.equal(front.cameraClass, "smartphone");
  assert.equal(front.formatId, "phone-9-16");
  assert.equal(front.orientation, "portrait");
  assert.equal(front.facing, "front");
  assert.equal(front.lens, "ultrawide");
  assert.equal(describeCamera(front), "Smartphone · 9:16 vertical · front camera · ultrawide");

  const rear = detectCameraFormat({width: 1920, height: 1080, facingMode: "environment", label: "Back Telephoto Camera"});
  assert.equal(rear.cameraClass, "smartphone");
  assert.equal(rear.formatId, "phone-16-9");
  assert.equal(rear.orientation, "landscape");
  assert.equal(rear.facing, "rear");
  assert.equal(rear.lens, "telephoto");

  const sensor = detectCameraFormat({width: 4032, height: 3024, label: "Camera 0, Facing back"});
  assert.equal(sensor.formatId, "phone-4-3");
  assert.equal(sensor.cameraClass, "smartphone");
  assert.equal(sensor.facing, "rear");
  assert.equal(detectCameraFormat({width: 1080, height: 1440}).formatId, "phone-3-4");
  assert.equal(detectCameraFormat({width: 1080, height: 1080}).formatId, "phone-1-1");
  assert.equal(detectCameraFormat({width: 1080, height: 1080}).orientation, "square");
});

test("detects digital cinema gates and delivery frames", () => {
  const dci = detectCameraFormat({width: 4096, height: 2160, label: "DeckLink 8K Pro"});
  assert.equal(dci.cameraClass, "digital-cinema");
  assert.equal(dci.formatId, "dci-17-9");
  assert.equal(describeCamera(dci), "Digital cinema · DCI 17:9");
  assert.equal(detectCameraFormat({width: 2048, height: 1080}).formatId, "dci-17-9");
  assert.equal(detectCameraFormat({width: 4096, height: 1716, label: "ARRI Alexa"}).formatId, "scope-239");
  assert.equal(detectCameraFormat({width: 2048, height: 858}).formatId, "scope-239");
  assert.equal(detectCameraFormat({width: 3996, height: 2160}).formatId, "flat-185");
  assert.equal(detectCameraFormat({width: 1998, height: 1080}).formatId, "flat-185");
  assert.equal(detectCameraFormat({width: 3840, height: 1920}).formatId, "univisium-200");
  const gate = detectCameraFormat({width: 6000, height: 4000, label: "ARRI Alexa Open Gate"});
  assert.equal(gate.formatId, "open-gate-32");
  assert.equal(gate.cameraClass, "digital-cinema");
  assert.equal(gate.sensor, "open-gate");
  const anamorphic = detectCameraFormat({width: 2880, height: 2160, label: "Super 35 anamorphic"});
  assert.equal(anamorphic.formatId, "anamorphic-43");
  assert.equal(anamorphic.cameraClass, "digital-cinema");
  assert.equal(anamorphic.sensor, "super35");
  const uhd = detectCameraFormat({width: 3840, height: 2160, label: "Blackmagic HDMI"});
  assert.equal(uhd.cameraClass, "digital-cinema");
  assert.equal(uhd.formatId, "uhd-16-9");
  assert.equal(detectCameraFormat({aspectRatio: 17 / 9}).formatId, "dci-17-9");
  assert.equal(detectCameraFormat({aspectRatio: 17 / 9}).orientation, "landscape");
  assert.equal(detectCameraFormat({aspectRatio: 9 / 16}).orientation, "portrait");
});

test("shared 16:9 sizes follow the stronger camera signal", () => {
  const phone = detectCameraFormat({width: 3840, height: 2160, facingMode: "environment", label: "Back Camera"});
  assert.equal(phone.cameraClass, "smartphone");
  assert.equal(phone.formatId, "phone-16-9");
  const webcam = detectCameraFormat({width: 1280, height: 720, label: "HD Webcam"});
  assert.equal(webcam.cameraClass, "unknown");
  assert.equal(webcam.formatId, "phone-16-9");
  const smallGate = detectCameraFormat({width: 1500, height: 1000});
  assert.equal(smallGate.formatId, "open-gate-32");
  assert.equal(smallGate.cameraClass, "unknown");
  assert.equal(detectCameraFormat({}).formatId, "");
  assert.equal(detectCameraFormat({width: 0, height: 0, label: "nope"}).cameraClass, "unknown");
});

test("sizes match mode, phone frames, and cinema frames", () => {
  const matched = outputDimensions({profileId: "match", width: 320, sourceWidth: 320, sourceHeight: 200, crop: full});
  assert.deepEqual([matched.width, matched.height], [320, 200]);
  const cropped = outputDimensions({profileId: "match", width: 320, sourceWidth: 320, sourceHeight: 200, crop: [0, 0, 50, 100]});
  assert.deepEqual([cropped.width, cropped.height], [320, 400]);
  assert.equal(outputDimensions({profileId: "phone-9-16", width: 320}).height, 569);
  assert.equal(outputDimensions({profileId: "phone-16-9", width: 480}).height, 270);
  assert.equal(outputDimensions({profileId: "phone-4-3", width: 320}).height, 240);
  assert.equal(outputDimensions({profileId: "phone-3-4", width: 320}).height, 427);
  assert.equal(outputDimensions({profileId: "phone-1-1", width: 321}).height, 321);
  assert.equal(outputDimensions({profileId: "dci-17-9", width: 512}).height, 270);
  assert.equal(outputDimensions({profileId: "dci-17-9", width: 768}).height, 405);
  assert.equal(outputDimensions({profileId: "scope-239", width: 478, framing: "fit", sourceWidth: 1920, sourceHeight: 1080}).height, 200);
  assert.equal(outputDimensions({profileId: "univisium-200", width: 480}).height, 240);
  assert.equal(outputDimensions({profileId: "flat-185", width: 370}).height, 200);
  assert.equal(outputDimensions({profileId: "open-gate-32", width: 720}).height, 480);
  assert.equal(outputDimensions({profileId: "uhd-16-9", width: 320}).height, 180);
  assert.equal(outputDimensions({profileId: "anamorphic-43", width: 320}).height, 240);
  const custom = outputDimensions({profileId: "custom", width: 321, height: 181});
  assert.deepEqual([custom.width, custom.height], [321, 181]);
  const squeezed = outputDimensions({profileId: "desqueeze-200", width: 640, framing: "fit", sourceWidth: 2880, sourceHeight: 2160});
  assert.equal(squeezed.height, 240);
  assert.equal(squeezed.framing, "crop");
  assert.equal(squeezed.desqueeze, 2);
  assert.equal(outputDimensions({profileId: "desqueeze-150", width: 480, sourceWidth: 2880, sourceHeight: 2160}).height, 240);
  assert.equal(outputDimensions({profileId: "desqueeze-180", width: 480, sourceWidth: 2880, sourceHeight: 2160}).height, 200);
  assert.equal(outputDimensions({profileId: "desqueeze-133", width: 480, sourceWidth: 2880, sourceHeight: 2160}).height, 271);
  assert.equal(outputDimensions({profileId: "desqueeze-133", width: 320}).pending, true);
  assert.equal(heightForAspect(320, 16 / 9), 180);
  assert.equal(outputDimensions({profileId: "match", width: 320}).pending, true);
});

test("framing covers or fits without stretching, and desqueeze is explicit", () => {
  const cover = placeSource({sourceWidth: 1920, sourceHeight: 1080, outWidth: 478, outHeight: 200, framing: "crop"});
  assert.ok(Math.abs(cover.dw / cover.dh - 1920 / 1080) < 1e-9);
  assert.ok(cover.dh > 200);
  assert.ok(Math.abs(cover.dy - (200 - cover.dh) / 2) < 1e-9);
  const fit = placeSource({sourceWidth: 1920, sourceHeight: 1080, outWidth: 478, outHeight: 200, framing: "fit"});
  assert.ok(Math.abs(fit.dw / fit.dh - 1920 / 1080) < 1e-9);
  assert.ok(fit.dw < 478);
  assert.ok(fit.dh <= 200 + 1e-6);
  assert.ok(fit.dx > 0);
  const matched = placeSource({sourceWidth: 320, sourceHeight: 200, crop: [0, 0, 50, 100], outWidth: 320, outHeight: 400});
  assert.equal(matched.sw, 160);
  assert.equal(matched.dx, 0);
  assert.equal(matched.dw, 320);
  assert.equal(matched.dh, 400);
  const portrait = placeSource({sourceWidth: 1080, sourceHeight: 1920, outWidth: 320, outHeight: 569, framing: "crop"});
  assert.ok(Math.abs(portrait.dw / portrait.dh - 1080 / 1920) < 1e-9);
  const desqueezed = placeSource({sourceWidth: 2880, sourceHeight: 2160, outWidth: 640, outHeight: 240, desqueeze: 2});
  assert.ok(Math.abs(desqueezed.dw / desqueezed.dh - (2880 / 2160) * 2) < 1e-9);
  assert.equal(desqueezed.dx, 0);
  assert.equal(desqueezed.dy, 0);
});

test("readout and pixel budget stay explicit", () => {
  const sized = outputDimensions({profileId: "scope-239", width: 478, framing: "fit"});
  const detection = detectCameraFormat({width: 4096, height: 2160, label: "DeckLink"});
  assert.match(formatReadout({sized, detection}), /Detected Digital cinema · DCI 17:9\. Cinema Scope 2\.39:1 · 478×200 · fit inside\./);
  assert.equal(formatReadout({sized: outputDimensions({profileId: "match", width: 320}), imageMode: false}), "Output follows the camera frame. Width stays 100–800 px.");
  assert.match(formatReadout({imageMode: true, originalSize: true}), /Original image size stays on/);
  assert.doesNotThrow(() => assertLoopBudget(320, 400, 50));
  assert.throws(() => assertLoopBudget(800, 800, 200), /Lower the frame rate or width/);
  assert.throws(() => assertLoopBudget(2000, 2000, 1), /smaller width/);
  assert.throws(() => outputDimensions({profileId: "nope", width: 320}), /camera format/);
  assert.throws(() => outputDimensions({profileId: "match", width: 80}), /100–800/);
  assert.throws(() => outputDimensions({profileId: "custom", width: 320, height: 1}), /2–4096/);
  assert.throws(() => outputDimensions({profileId: "custom", width: 800, height: 2001}), /smaller width/);
  assert.throws(() => outputDimensions({profileId: "match", width: 320, crop: [0, 0, 120, 10]}), /Crop must fit/);
  assert.throws(() => createGifEncoder({width: 4000, height: 4000, samples: [], fps: 10}), /smaller width/);
});

test("a live feed updates match output when its dimensions change", () => {
  const phone = liveMatchSize({outputWidth: 320, sourceWidth: 1920, sourceHeight: 1080});
  assert.equal(phone.height, 180);
  assert.equal(detectCameraFormat({width: 1920, height: 1080, facingMode: "environment", label: "Back Camera"}).formatId, "phone-16-9");
  const rotated = liveMatchSize({outputWidth: 320, sourceWidth: 1080, sourceHeight: 1920});
  assert.equal(rotated.height, 569);
  assert.equal(detectCameraFormat({width: 1080, height: 1920, facingMode: "environment", label: "Back Camera"}).formatId, "phone-9-16");
  const cinema = liveMatchSize({outputWidth: 512, sourceWidth: 4096, sourceHeight: 2160});
  assert.equal(cinema.height, 270);
  assert.equal(detectCameraFormat({width: 4096, height: 2160, label: "DeckLink 8K Pro"}).formatId, "dci-17-9");
  const readout = formatReadout({
    sized: cinema,
    detection: detectCameraFormat({width: 4096, height: 2160, label: "DeckLink 8K Pro"}),
  });
  assert.match(readout, /Match camera · Digital cinema · DCI 17:9 · 512×270/);
});

test("screen orientation lock holds the output and a camera setting still resizes it", () => {
  const locked = orientSource(1920, 1080, "portrait");
  assert.equal(locked.flipped, true);
  assert.deepEqual([locked.width, locked.height], [1080, 1920]);
  assert.equal(liveMatchSize({outputWidth: 320, sourceWidth: locked.width, sourceHeight: locked.height, lock: "portrait"}).height, 569);
  const stillPortrait = orientSource(1080, 1920, "portrait");
  assert.equal(stillPortrait.flipped, false);
  assert.equal(liveMatchSize({outputWidth: 320, sourceWidth: stillPortrait.width, sourceHeight: stillPortrait.height, lock: "portrait"}).height, 569);
  const heldLandscape = orientSource(1080, 1920, "landscape");
  assert.deepEqual([heldLandscape.width, heldLandscape.height], [1920, 1080]);
  assert.equal(liveMatchSize({outputWidth: 320, sourceWidth: heldLandscape.width, sourceHeight: heldLandscape.height, lock: "landscape"}).height, 180);
  const unlocked = orientSource(1080, 1920, "");
  assert.equal(unlocked.locked, false);
  assert.equal(liveMatchSize({outputWidth: 320, sourceWidth: unlocked.width, sourceHeight: unlocked.height}).height, 569);
  const setting = orientSource(1440, 1080, "landscape");
  assert.equal(setting.flipped, false);
  assert.equal(liveMatchSize({outputWidth: 320, sourceWidth: setting.width, sourceHeight: setting.height, lock: "landscape"}).height, 240);
  const sized = liveMatchSize({outputWidth: 320, sourceWidth: 1920, sourceHeight: 1080, lock: "portrait"});
  assert.match(formatReadout({sized, orientationLock: "portrait", detection: detectCameraFormat({width: 1920, height: 1080, facingMode: "environment", label: "Back Camera"})}), /Locked portrait/);
});

test("track settings and video resize both move the live size", () => {
  let reading = chooseLiveSize({}, {videoWidth: 1920, videoHeight: 1080, settingsWidth: 1920, settingsHeight: 1080});
  assert.equal(reading.source, "settings");
  reading = chooseLiveSize(reading, {videoWidth: 1920, videoHeight: 1080, settingsWidth: 4096, settingsHeight: 2160});
  assert.deepEqual([reading.width, reading.height, reading.source], [4096, 2160, "settings"]);
  reading = chooseLiveSize(reading, {videoWidth: 1080, videoHeight: 1920, settingsWidth: 4096, settingsHeight: 2160});
  assert.deepEqual([reading.width, reading.height, reading.source], [1080, 1920, "video"]);
  const modes = cameraModes({width: {min: 640, max: 1920}, height: {min: 480, max: 1080}});
  assert.deepEqual(modes, [[640, 480], [1280, 720], [1920, 1080]]);
  const constraints = constraintsForMode(1920, 1080);
  assert.equal(constraints.width.ideal, 1920);
  assert.equal(constraints.height.ideal, 1080);
  assert.ok(Math.abs(constraints.aspectRatio.ideal - 16 / 9) < 1e-9);
});

test("master matrix exact sizes and seven desqueeze factors match the technical reference", () => {
  const exact = [
    [4608, 3164, "open-gate-32"], [3164, 4608, "open-gate-32"],
    [4448, 3096, "open-gate-32"], [6560, 3100, "univisium-200"],
    [8192, 4320, "dci-17-9"], [4320, 8192, "dci-17-9"],
    [6144, 3240, "dci-17-9"], [8640, 5760, "open-gate-32"],
    [6048, 4032, "open-gate-32"], [4032, 6048, "open-gate-32"],
    [8632, 4856, "uhd-16-9"], [6144, 3456, "uhd-16-9"],
    [12288, 6480, "dci-17-9"], [17520, 8040, "univisium-200"],
    [5776, 4336, "anamorphic-43"], [6024, 4016, "open-gate-32"],
    [3520, 2640, "anamorphic-43"], [3300, 2500, "anamorphic-43"],
    [3328, 2790, "anamorphic-43"], [2790, 3328, "anamorphic-43"],
    [4224, 3024, "phone-4-3"], [3024, 4224, "phone-3-4"],
    [1920, 1440, "phone-4-3"], [1440, 1920, "phone-3-4"],
    [1024, 576, "uhd-16-9"], [576, 1024, "phone-9-16"],
    [640, 480, "phone-4-3"], [480, 640, "phone-3-4"],
    [2520, 1080, "scope-239"], [1080, 2520, "phone-9-16"],
  ];
  for (const [width, height, id] of exact) {
    assert.equal(detectCameraFormat({width, height}).formatId, id, `${width}x${height}`);
  }
  assert.equal(detectCameraFormat({width: 2520, height: 1080, label: "Xperia Cinema Pro"}).formatId, "scope-239");
  assert.equal(detectCameraFormat({width: 2100, height: 900, label: "Xperia"}).formatId, "scope-239");
  assert.equal(detectCameraFormat({width: 1920, height: 1080, label: "Xperia"}).cameraClass, "smartphone");
  assert.equal(detectCameraFormat({width: 1920, height: 1440, label: "iPhone Continuity Camera"}).formatId, "phone-4-3");
  assert.equal(detectCameraFormat({width: 1920, height: 1080, label: "Android DeviceAsWebcam"}).formatId, "phone-16-9");
  assert.equal(detectCameraFormat({width: 1024, height: 576, label: "Imaging Edge Webcam"}).formatId, "uhd-16-9");
  assert.equal(detectCameraFormat({width: 1080, height: 1080, label: "Center Stage"}).formatId, "phone-1-1");
  const factors = [
    ["desqueeze-125", 1.25, 192, 384],
    ["desqueeze-130", 1.3, 185, 369],
    ["desqueeze-133", 1.33, 180, 361],
    ["desqueeze-150", 1.5, 160, 320],
    ["desqueeze-160", 1.6, 150, 300],
    ["desqueeze-180", 1.8, 133, 267],
    ["desqueeze-200", 2, 120, 240],
  ];
  for (const [id, factor, at320, at640] of factors) {
    assert.equal(PROFILES[id].desqueeze, factor);
    assert.equal(outputDimensions({profileId: id, width: 320, sourceWidth: 2880, sourceHeight: 2160}).height, at320, id);
    assert.equal(outputDimensions({profileId: id, width: 640, sourceWidth: 2880, sourceHeight: 2160}).height, at640, `${id}-640`);
  }
  assert.equal(outputDimensions({profileId: "desqueeze-200", width: 320, sourceWidth: 3328, sourceHeight: 2790}).height, 134);
  assert.equal(outputDimensions({profileId: "desqueeze-200", width: 640, sourceWidth: 3328, sourceHeight: 2790}).height, 268);
  const table = {
    "phone-9-16": 569, "phone-16-9": 180, "phone-4-3": 240, "phone-3-4": 427, "phone-1-1": 320,
    "dci-17-9": 169, "uhd-16-9": 180, "scope-239": 134, "univisium-200": 160, "flat-185": 173,
    "open-gate-32": 213, "anamorphic-43": 240,
  };
  for (const [id, height] of Object.entries(table)) {
    assert.equal(outputDimensions({profileId: id, width: 320}).height, height, id);
  }
});
