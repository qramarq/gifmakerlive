import { createVideoEditor } from "./video-editor.js";
import { animateImage } from "./motion.js";
import { convertVideo } from "./video-gif.js";
import { PROFILES, cameraModes, chooseLiveSize, constraintsForMode, detectCameraFormat, formatReadout, liveMatchSize, orientSource, outputDimensions } from "./camera-format.js";
const $ = id => document.getElementById(id);
let clip, stream, recorder, sourceUrl, gifUrl, timer, busy = false, recordingBytes = 0;
let imageMode = false, selectionVersion = 0, activeJob, detection = null;
let liveToken = 0, liveKey = '', liveReading = {};
const editor = createVideoEditor($('video'), $('video-editor'), () => {
  clearResult(); $('video').hidden = false; $('convert').textContent = 'Create GIF ↗';
  status('Edits updated. Preview your selection or create a GIF.');
  refreshOutput();
}, () => ({profile: $('camera-profile').value, framing: $('framing').value, width: Number($('width').value), height: Number($('height').value)}));
const MAX_BYTES = 100 * 1024 * 1024;
function syncSettings(height = 0) {
  const detected = ($('camera-readout').textContent || '').slice(0, 160);
  $('settings').contentWindow.postMessage({
    type: 'gif-host-settings',
    fps: Number($('fps').value),
    width: Number($('width').value),
    duration: Number($('duration').value),
    imageMode,
    profile: $('camera-profile').value,
    framing: $('framing').value,
    height,
    detected,
  }, location.origin);
}
function currentSource() {
  if (!imageMode && stream && liveReading.width) return {width: liveReading.width, height: liveReading.height};
  if (!imageMode && $('video').videoWidth) return {width: $('video').videoWidth, height: $('video').videoHeight};
  if (imageMode && $('still').naturalWidth) return {width: $('still').naturalWidth, height: $('still').naturalHeight};
  return null;
}
function currentCrop() {
  if (imageMode) return [0, 0, 100, 100];
  const values = editor.crop();
  return values.every(value => Number.isFinite(value)) ? values : [0, 0, 100, 100];
}
function refreshOutput() {
  const profileId = $('camera-profile').value;
  if (PROFILES[profileId]?.desqueeze) $('framing').value = 'crop';
  const custom = profileId === 'custom';
  const originalSize = $('original-size').checked;
  $('height').readOnly = !custom;
  $('height').required = custom;
  $('framing').disabled = busy || Boolean(PROFILES[profileId]?.desqueeze);
  let sized = null;
  const src = currentSource();
  const orientationLock = profileId === 'match' && stream ? $('orientation-mode').value : '';
  try {
    sized = profileId === 'match'
      ? liveMatchSize({outputWidth: Number($('width').value), sourceWidth: src?.width || 0, sourceHeight: src?.height || 0, lock: orientationLock, crop: currentCrop()})
      : outputDimensions({
        profileId,
        framing: $('framing').value,
        width: Number($('width').value),
        height: Number($('height').value),
        sourceWidth: src?.width || 0,
        sourceHeight: src?.height || 0,
        crop: currentCrop(),
      });
    if (!custom && sized.height) $('height').value = String(sized.height);
  } catch (error) {
    $('camera-readout').textContent = error.message;
  }
  if (sized) {
    $('camera-readout').textContent = formatReadout({
      sized, detection: imageMode ? null : detection, imageMode, originalSize,
      orientationLock,
      sourceWidth: profileId === 'match' ? src?.width || 0 : 0,
      sourceHeight: profileId === 'match' ? src?.height || 0 : 0,
    });
  }
  const displayHeight = imageMode && originalSize ? 0 : (sized?.height || 0);
  syncSettings(displayHeight);
  editor.refresh();
}
for (const id of ['fps', 'width', 'duration', 'framing']) $(id).addEventListener('change', refreshOutput);
$('camera-profile').addEventListener('change', () => { if (stream) noteLiveFrame(true); else refreshOutput(); });
$('height').addEventListener('input', () => {
  if ($('camera-profile').value !== 'custom') $('camera-profile').value = 'custom';
  refreshOutput();
});
$('original-size').addEventListener('change', refreshOutput);
document.querySelectorAll('[data-prompt]').forEach(button => {button.onclick = () => {$('motion-prompt').value=button.dataset.prompt; $('motion-prompt').focus();};});
$('animate-toggle').onchange = () => {
  if (busy) return;
  imageMode=$('animate-toggle').checked; selectionVersion++;
  activeJob?.abort();
  stopCamera(); editor.hide(); clearResult(); clip=undefined; detection=null;
  if(sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl=undefined;
  $('video').removeAttribute('src'); $('still').removeAttribute('src');
  $('video').hidden=$('still').hidden=true; $('empty').hidden=false;
  $('workspace').classList.toggle('image-mode',imageMode); $('motion-panel').hidden=!imageMode;
  $('camera-tab').hidden=imageMode; $('upload-tab').textContent=imageMode?'Upload image':'Upload video';
  $('upload-tab').classList.add('selected'); $('camera-tab').classList.remove('selected');
  $('file').accept=imageMode?'.png,.jpg,.jpeg,.webp':'.mp4,.mov,.webm,.avi,.mkv,.m4v';
  $('drop-label').textContent=imageMode?'Drop a still image into the studio':'Drop your video into the studio';
  $('browse').textContent=imageMode?'Choose an image ↗':'Choose a video ↗';
  $('upload-hint').textContent=imageMode?'PNG, JPEG, WebP · Up to 20 MiB':'MP4, MOV, WebM the browser can play · Up to 30 seconds / 100 MiB';
  $('replace').hidden=true; $('preview-tag').hidden=true;
  $('replace').textContent=imageMode?'Replace image':'Replace clip';
  $('filename').textContent=imageMode?'No image selected':'No clip selected';
  $('convert').disabled=true; $('convert').textContent=imageMode?'Animate image ↗':'Create GIF ↗';
  $('motion-prompt').required=imageMode;
  status(imageMode?'Choose an image and describe its motion.':'Your next favorite loop is one clip away.');
  refreshOutput();
};
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearResult() {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = undefined; $('gif').hidden = true; $('download').hidden = true; $('convert').hidden = false;
}
function stopLiveWatch() {
  liveToken++;
  liveKey = '';
  liveReading = {};
  $('video').removeEventListener('resize', onVideoResize);
}
function stopCamera() {
  selectionVersion++;
  clearTimeout(timer);
  if (recorder) { recorder.onstop = null; if (recorder.state === 'recording') recorder.stop(); }
  stopLiveWatch();
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  $('record').hidden = true; $('camera-device').hidden = true; $('live-camera-tools').hidden = true;
  $('orientation-mode').value = ''; $('orientation-note').textContent = '';
  $('video').srcObject = null;
}
function noteLiveFrame(force) {
  if (!stream || imageMode || busy) return;
  const video = $('video');
  const track = stream.getVideoTracks?.()[0];
  const settings = track?.getSettings?.() || {};
  const next = chooseLiveSize(liveReading, {
    videoWidth: video.videoWidth || 0,
    videoHeight: video.videoHeight || 0,
    settingsWidth: settings.width || 0,
    settingsHeight: settings.height || 0,
  });
  const lock = $('camera-profile').value === 'match' ? $('orientation-mode').value : '';
  const oriented = orientSource(next.width, next.height, lock);
  const key = `${next.width}x${next.height}:${oriented.width}x${oriented.height}:${lock}`;
  liveReading = next;
  if (!next.width || !next.height) return;
  if (!force && key === liveKey) return;
  liveKey = key;
  detection = detectCameraFormat({
    width: next.width,
    height: next.height,
    aspectRatio: settings.aspectRatio,
    facingMode: settings.facingMode,
    label: track?.label || '',
  });
  refreshOutput();
}
function onVideoResize() { noteLiveFrame(true); }
function startLiveWatch() {
  stopLiveWatch();
  const video = $('video');
  const token = liveToken;
  const tick = () => {
    if (token !== liveToken || !stream) return;
    noteLiveFrame(false);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };
  video.addEventListener('resize', onVideoResize);
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
  else requestAnimationFrame(tick);
  noteLiveFrame(true);
}
function fillResolutions(track) {
  const select = $('camera-resolution');
  const settings = track?.getSettings?.() || {};
  const modes = cameraModes(track?.getCapabilities?.() || {});
  select.replaceChildren();
  const current = document.createElement('option');
  current.value = '';
  current.textContent = settings.width && settings.height ? `Current ${settings.width}×${settings.height}` : 'Current resolution';
  select.append(current);
  for (const [width, height] of modes) {
    const option = document.createElement('option');
    option.value = `${width}x${height}`;
    option.textContent = `${width}×${height}`;
    select.append(option);
  }
}
async function setOrientationMode(mode) {
  const lock = mode === 'portrait' || mode === 'landscape' ? mode : '';
  $('orientation-mode').value = lock;
  const api = screen.orientation;
  if (!lock) {
    try { await api?.unlock?.(); } catch { /* already unlocked, or unsupported */ }
    $('orientation-note').textContent = '';
  } else {
    let native = false;
    try {
      if (api?.lock) { await api.lock(lock); native = true; }
    } catch { native = false; }
    $('orientation-note').textContent = native ? '' : 'Output stays in this orientation. This browser does not lock the screen itself.';
  }
  noteLiveFrame(true);
}
function inspectTrack(mediaStream) {
  const track = mediaStream?.getVideoTracks?.()[0];
  if (!track) return null;
  const settings = track.getSettings?.() || {};
  const video = $('video');
  return detectCameraFormat({
    width: settings.width || video.videoWidth,
    height: settings.height || video.videoHeight,
    aspectRatio: settings.aspectRatio,
    facingMode: settings.facingMode,
    label: track.label || '',
  });
}
function inspectVideo() {
  const video = $('video');
  if (!video.videoWidth || video.srcObject) return;
  const kept = detection;
  detection = detectCameraFormat({
    width: video.videoWidth,
    height: video.videoHeight,
    label: kept?.label || clip?.name || '',
    facingMode: kept?.facingMode || '',
  });
}
async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices || !stream) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
  const select = $('camera-device');
  const current = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || '';
  select.replaceChildren();
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${select.length + 1}`;
    if (device.deviceId === current) option.selected = true;
    select.append(option);
  }
  select.hidden = devices.length < 2;
}
function selectFile(file, keptDetection) {
  if (busy || !file) return;
  const supported=imageMode?/\.(png|jpe?g|webp)$/i:/\.(mp4|mov|webm|avi|mkv|m4v)$/i;
  if (!supported.test(file.name)) return status(imageMode?'Choose a still PNG, JPEG, or WebP image.':'Choose an MP4, MOV, WebM, AVI, MKV or M4V video.', true);
  if (!file.size || file.size > (imageMode?20*1024*1024:MAX_BYTES)) return status(imageMode?'Choose a nonempty image smaller than 20 MiB.':'Choose a nonempty video smaller than 100 MiB.', true);
  selectionVersion++; activeJob?.abort();
  stopCamera(); clearResult(); clip = file;
  detection = imageMode ? null : (keptDetection || null);
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  const video = $('video'); video.hidden=imageMode; $('still').hidden=!imageMode;
  if(imageMode) { editor.hide(); $('still').src=sourceUrl; }
  else {video.src = sourceUrl; video.muted = false; video.controls = true; editor.show();}
  $('empty').hidden = true; $('preview-tag').hidden = true; $('replace').hidden = false;
  $('filename').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB`;
  $('convert').disabled = false; $('convert').textContent=imageMode?'Animate image ↗':'Create GIF ↗'; $('upload-tab').classList.add('selected'); $('camera-tab').classList.remove('selected');
  status(imageMode?'Original loaded. Describe one motion, or choose an example.':'Ready when you are. Pick your settings and create a GIF.');
  refreshOutput();
}
$('browse').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = e => { selectFile(e.target.files[0]); e.target.value = ''; };
$('upload-tab').onclick = () => { if (!busy) { stopCamera(); $('file').click(); } };
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.add('dragover');});
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.remove('dragover');});
$('dropzone').addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
async function openCamera(deviceId) {
  if (busy || imageMode) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return status('Camera recording is unavailable in this browser. Upload a clip instead.', true);
  const version = ++selectionVersion;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  try {
    const camera = await navigator.mediaDevices.getUserMedia({video: deviceId ? {deviceId: {exact: deviceId}} : true, audio: false});
    if (version !== selectionVersion || imageMode || busy) { camera.getTracks().forEach(track => track.stop()); return; }
    stream = camera;
    clearResult(); editor.hide(); clip = undefined; $('convert').disabled = true;
    $('video').srcObject = stream; $('video').muted = true; $('video').controls = false; $('video').hidden = false;
    await $('video').play();
    if (version !== selectionVersion || imageMode || busy) { camera.getTracks().forEach(track => track.stop()); return; }
    $('empty').hidden = true; $('record').hidden = false; $('replace').hidden = true;
    $('preview-tag').hidden = false; $('record').textContent = '● Start recording';
    $('live-camera-tools').hidden = false;
    fillResolutions(stream.getVideoTracks()[0]);
    $('camera-tab').classList.add('selected'); $('upload-tab').classList.remove('selected');
    $('filename').textContent = 'Camera ready · 30-second limit';
    startLiveWatch();
    const found = detection?.formatId ? $('camera-readout').textContent : 'the live camera';
    status(`Camera is ready (${found}). Output follows this camera until you lock orientation or pick a preset.`);
    refreshDevices().catch(() => {});
  } catch (error) {
    if (version === selectionVersion) { stopCamera(); status('Camera access failed. Check your browser permission or upload a video.', true); }
  }
}
$('camera-tab').onclick = () => { if (!stream) openCamera(); };
$('camera-device').onchange = () => { if (!busy && stream && recorder?.state !== 'recording') openCamera($('camera-device').value); };
$('orientation-mode').onchange = () => { if (!busy) setOrientationMode($('orientation-mode').value); };
$('camera-resolution').onchange = async () => {
  const value = $('camera-resolution').value;
  if (!value || !stream || busy) return;
  if (recorder?.state === 'recording') { $('camera-resolution').value = ''; return; }
  const [width, height] = value.split('x').map(Number);
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints(constraintsForMode(width, height)); }
  catch { status('This camera kept its current resolution.', true); }
  noteLiveFrame(true);
  fillResolutions(track);
};
screen.orientation?.addEventListener?.('change', () => noteLiveFrame(true));
window.addEventListener('orientationchange', () => noteLiveFrame(true));
window.matchMedia?.('(orientation: portrait)')?.addEventListener?.('change', () => noteLiveFrame(true));
function onVideoReady() {
  if (imageMode) return;
  if (stream) noteLiveFrame(true);
  else { inspectVideo(); refreshOutput(); }
}
$('video').addEventListener('loadedmetadata', onVideoReady);
$('video').addEventListener('loadeddata', onVideoReady);
$('still').addEventListener('load', () => { if (imageMode) refreshOutput(); });
$('record').onclick = () => {
  if (recorder?.state === 'recording') {recorder.stop(); return;}
  try {
    const mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('No supported recording format');
    recorder = new MediaRecorder(stream, {mimeType});
    const chunks = []; recordingBytes = 0;
    recorder.ondataavailable = e => {if(e.data.size){chunks.push(e.data); recordingBytes += e.data.size; if(recordingBytes > MAX_BYTES && recorder.state === 'recording') recorder.stop();}};
    recorder.onerror = () => {stopCamera(); status('Recording failed. Please try again.', true);};
    recorder.onstop = () => {
      clearTimeout(timer);
      const kept = detection;
      const file = new File(chunks, `camera.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, {type:mimeType});
      stopCamera();
      selectFile(file, kept);
    };
    recorder.start(250); $('record').textContent = '■ Stop recording'; status('Recording… stops automatically after 30 seconds.');
    timer = setTimeout(() => {if(recorder.state === 'recording') recorder.stop();}, 30000);
  } catch(error) {stopCamera(); status('This camera could not start recording. Try uploading a video.', true);}
};
window.addEventListener('message', event => {
  if(event.origin !== location.origin || event.source !== $('settings').contentWindow) return;
  if(event.data?.type === 'gif-settings-ready') {refreshOutput();return;}
  if(event.data?.type === 'gif-settings-unavailable') {$('advanced').open = true; return;}
  if(busy) return;
  const {type,setting,fps,width,duration,profile,framing} = event.data ?? {};
  if(type === 'gif-settings') {
    if(setting==='fps' && Number.isInteger(fps) && fps>=1 && fps<=30) $('fps').value=fps;
    if(setting==='width' && Number.isInteger(width) && width>=100 && width<=800) $('width').value=width;
    if(setting==='duration' && Number.isInteger(duration) && duration>=1 && duration<=6) $('duration').value=duration;
    if(setting==='camera' && typeof profile === 'string' && Object.hasOwn(PROFILES, profile)) $('camera-profile').value=profile;
    if(setting==='framing' && (framing === 'crop' || framing === 'fit')) $('framing').value=framing;
    refreshOutput();
  }
});
// The iframe may finish before this module and its editor dependency load.
$('settings').contentWindow.postMessage({type:'gif-host-query'}, location.origin);
$('convert').onclick = async () => {
  if(!clip || busy) return;
  if(!$('fps').reportValidity() || !$('width').reportValidity()) return;
  if($('camera-profile').value === 'custom' && !$('height').reportValidity()) return;
  if(imageMode && (!$('motion-prompt').reportValidity() || !$('duration').reportValidity())) return;
  const edits = imageMode ? null : editor.data();
  if (!imageMode && !edits) return status('Check the segment times and crop. Keep the selection within 5 seconds.', true);
  editor.stop();
  selectionVersion++; busy = true; $('convert').disabled = true;
  const controls=['camera-tab','upload-tab','replace','browse','animate-toggle','motion-prompt','duration','original-size','fps','width','height','camera-profile','framing','camera-device','orientation-mode','camera-resolution','video-editor'];
  for(const id of controls) $(id).disabled = true;
  document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=true);
  $('settings').inert=true;
  clearResult(); $('video').pause(); $('still').hidden=!imageMode; $('video').hidden=imageMode;
  activeJob?.abort();
  const job = activeJob = new AbortController();
  const fps = Number($('fps').value), width = Number($('width').value);
  const profile = $('camera-profile').value, framing = $('framing').value, height = Number($('height').value);
  status(imageMode?'Rendering your original image into a loop…':'Applying your edits and creating your loop…');
  try {
    const result = imageMode
      ? await animateImage({file: clip, prompt: $('motion-prompt').value.trim(), fps, width, duration: Number($('duration').value), originalSize: $('original-size').checked, profile, framing, height, signal: job.signal, onProgress: message => status(message)})
      : await convertVideo({video: $('video'), edits, fps, width, profile, framing, height, signal: job.signal, onProgress: message => status(message)});
    if (job.signal.aborted) return;
    const blob = result.blob;
    if (!blob.type.startsWith('image/gif')) throw new Error('The GIF could not be created. Please try again.');
    gifUrl = URL.createObjectURL(blob);
    $('gif').src = gifUrl; $('gif').hidden = false; $('video').hidden = $('still').hidden = true;
    $('download').href = gifUrl; $('download').download = 'my-loop.gif'; $('download').hidden = false;
    $('convert').textContent = 'Create another version ↗';
    status(`Loop ready · Repeats continuously · ${(blob.size/1024).toFixed(1)} KB · ${result.fps} fps · ${result.width}×${result.height}`);
  } catch(error) { if (!job.signal.aborted) status(error.message || 'Unable to create the GIF.', true); }
  finally {busy = false; $('convert').disabled = !clip; $('convert').textContent = gifUrl ? 'Create another version ↗' : imageMode ? 'Animate image ↗' : 'Create GIF ↗'; for(const id of controls) $(id).disabled = false; document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=false); $('settings').inert=false; refreshOutput();}
};
window.addEventListener('pagehide', event => {if(recorder) recorder.onstop = null; activeJob?.abort(); stopCamera(); if(!event.persisted){if(sourceUrl) URL.revokeObjectURL(sourceUrl); if(gifUrl) URL.revokeObjectURL(gifUrl);}});
refreshOutput();
