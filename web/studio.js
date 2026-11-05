import { createVideoEditor } from "./video-editor.js";
import { animateImage } from "./motion.js";
import { convertVideo } from "./video-gif.js";
import {
  DEFAULT_CAPTURE_IDEAL, FRAME_PIXEL_BUDGET, MEDIA_RECORDER_LIMIT_MS,
  activeVideoTrack, bindDeviceChange, cameraErrorMessage, cameraSupport, createFrameGrabber,
  deviceOptions, directCapturePlan, encodeCameraFrames, enumerateVideoInputs, facingControlsVisible,
  formatCameraStatus, openCamera, openRecorder, readLiveVideoMetadata, recordingFilename,
  releaseStream, resolveCameraLabel, resolveGetUserMedia, samplePreviewFrame, startRecorder, watchLiveVideo,
} from "./camera.js";
const $ = id => document.getElementById(id);
let clip, stream, recorder, sourceUrl, gifUrl, timer, busy = false, recordingBytes = 0;
let imageMode = false, selectionVersion = 0, activeJob;
let frameGrabber, detachPreview, unwatchDevices, lastDevices = [], activeFacing = '', releasingCamera = false;
const editor = createVideoEditor($('video'), $('video-editor'), () => {
  clearResult(); $('video').hidden = false; $('convert').textContent = 'Create GIF ↗';
  status('Edits updated. Preview your selection or create a GIF.');
});
const MAX_BYTES = 100 * 1024 * 1024;
function syncSettings() {
  $('settings').contentWindow.postMessage({type:'gif-host-settings',fps:Number($('fps').value),width:Number($('width').value),duration:Number($('duration').value),imageMode},location.origin);
}
for (const id of ['fps','width','duration']) $(id).addEventListener('change',syncSettings);
document.querySelectorAll('[data-prompt]').forEach(button => {button.onclick = () => {$('motion-prompt').value=button.dataset.prompt; $('motion-prompt').focus();};});
$('animate-toggle').onchange = () => {
  if (busy) return;
  imageMode=$('animate-toggle').checked; selectionVersion++;
  activeJob?.abort();
  stopCamera(); editor.hide(); clearResult(); clip=undefined;
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
  syncSettings();
};
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearResult() {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = undefined; $('gif').hidden = true; $('download').hidden = true; $('convert').hidden = false;
}
function releaseHardware() {
  releasingCamera = true;
  clearTimeout(timer);
  detachPreview?.(); detachPreview = undefined;
  if (recorder) {
    const current = recorder;
    recorder = undefined;
    current.onstop = null; current.onerror = null; current.ondataavailable = null;
    if (current.state === 'recording') { try { current.stop(); } catch { /* already stopping */ } }
  }
  if (frameGrabber?.running) frameGrabber.stop();
  frameGrabber = undefined;
  releaseStream(stream); stream = undefined;
  if ($('video')) $('video').srcObject = null;
  releasingCamera = false;
}
function closeCameraUi() {
  unwatchDevices?.(); unwatchDevices = undefined;
  $('camera-controls').hidden = true; $('record').hidden = true; $('preview-tag').hidden = true;
  $('facing-user').hidden = true; $('facing-environment').hidden = true;
  setPickerEnabled(true);
}
function stopCamera() {
  selectionVersion++;
  releaseHardware();
  closeCameraUi();
}
function currentDeviceId() {
  return activeVideoTrack(stream)?.getSettings?.().deviceId || '';
}
function setPickerEnabled(enabled) {
  $('camera-device').disabled = !enabled;
  $('facing-user').disabled = !enabled;
  $('facing-environment').disabled = !enabled;
}
function updateFacingButtons() {
  const show = facingControlsVisible($('camera-device').value);
  $('facing-user').hidden = !show; $('facing-environment').hidden = !show;
  $('facing-user').setAttribute('aria-pressed', activeFacing === 'user' ? 'true' : 'false');
  $('facing-environment').setAttribute('aria-pressed', activeFacing === 'environment' ? 'true' : 'false');
}
function renderCameras(devices, activeDeviceId) {
  const select = $('camera-device');
  const {options, selected} = deviceOptions(devices, activeDeviceId);
  const signature = options.map(option => `${option.value}\n${option.label}`).join('\n');
  if (select.dataset.signature !== signature) {
    select.replaceChildren();
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value; node.textContent = option.label; select.append(node);
    }
    select.dataset.signature = signature;
  }
  const preferred = options.some(option => option.value === String(activeDeviceId || '')) ? String(activeDeviceId || '') : selected;
  if (select.value !== preferred) select.value = preferred;
  $('camera-controls').hidden = false;
  updateFacingButtons();
}
function ensureDeviceWatch() {
  if (unwatchDevices) return;
  unwatchDevices = bindDeviceChange(navigator.mediaDevices, () => { void refreshDeviceList(); });
}
async function refreshDeviceList() {
  const version = selectionVersion;
  const devices = await enumerateVideoInputs(navigator.mediaDevices);
  if (version !== selectionVersion || imageMode) return;
  lastDevices = devices;
  if (!$('camera-controls').hidden) renderCameras(devices, $('camera-device').value);
}
function showLiveStatus(meta, info) {
  const labeled = {...meta, label: resolveCameraLabel(meta, lastDevices)};
  if (recorder?.state === 'recording' || frameGrabber?.running) return;
  $('filename').textContent = `${formatCameraStatus(labeled)} · 30-second limit`;
  if (info?.changedSize) status(`${formatCameraStatus(labeled)}. The live camera picture changed size.`);
}
function attachStream(next, version, request) {
  stream = next;
  const video = $('video');
  clearResult(); editor.hide(); clip = undefined; $('convert').disabled = true;
  video.srcObject = stream; video.muted = true; video.controls = false; video.playsInline = true; video.hidden = false;
  $('still').hidden = true; $('empty').hidden = true; $('replace').hidden = true;
  $('record').hidden = false; $('record').textContent = '● Start recording'; $('preview-tag').hidden = false;
  $('camera-tab').classList.add('selected'); $('upload-tab').classList.remove('selected');
  detachPreview?.();
  detachPreview = watchLiveVideo(video, () => activeVideoTrack(stream), (meta, info) => {
    if (version !== selectionVersion) return;
    showLiveStatus(meta, info);
  });
  const track = activeVideoTrack(stream);
  if (track) track.addEventListener('ended', () => handleTrackEnded(track));
  const meta = readLiveVideoMetadata(video, track);
  renderCameras(lastDevices, request?.deviceId ? (meta.deviceId || request.deviceId) : '');
  activeFacing = request?.facingMode || (request?.deviceId ? (meta.facingMode || '') : activeFacing);
  updateFacingButtons();
  setPickerEnabled(true);
  status('Camera is ready. Start recording when you are.');
}
function handleTrackEnded(track) {
  if (releasingCamera || !stream?.getTracks?.().includes(track)) return;
  if (recorder?.state === 'recording') { try { recorder.stop(); } catch { /* onstop reports the failure */ } return; }
  if (frameGrabber?.running) { void finishDirectGif(frameGrabber.stop()); return; }
  releaseHardware();
  $('record').hidden = true; $('preview-tag').hidden = true; $('video').hidden = true;
  if (!clip) $('empty').hidden = false;
  status('The camera disconnected. Choose another camera, or reconnect it and try again.', true);
  void refreshDeviceList();
}
async function startCamera(request) {
  if (busy || imageMode || recorder?.state === 'recording' || frameGrabber?.running) return;
  const version = ++selectionVersion;
  releaseHardware();
  try {
    const support = cameraSupport({navigator, isSecureContext: window.isSecureContext});
    const getUserMedia = resolveGetUserMedia(navigator);
    if (!support.secure || !getUserMedia) {
      closeCameraUi();
      status(cameraErrorMessage(null, {secure: support.secure, getUserMedia: Boolean(getUserMedia)}), true);
      return;
    }
    ensureDeviceWatch();
    lastDevices = await enumerateVideoInputs(navigator.mediaDevices);
    if (version !== selectionVersion || imageMode || busy) return;
    if (lastDevices.length || request.deviceId || request.facingMode) renderCameras(lastDevices, request.deviceId || '');
    setPickerEnabled(false);
    status(lastDevices.some(device => device.label) ? 'Opening that camera…' : 'Allow camera access to name every connected camera.');
    const opened = await openCamera(getUserMedia, request);
    if (version !== selectionVersion || imageMode || busy) { releaseStream(opened.stream); return; }
    lastDevices = await enumerateVideoInputs(navigator.mediaDevices);
    if (version !== selectionVersion || imageMode || busy) { releaseStream(opened.stream); return; }
    attachStream(opened.stream, version, request);
    try { await $('video').play(); } catch { /* The preview stays attached when autoplay is blocked. */ }
  } catch (error) {
    if (version !== selectionVersion) return;
    releaseHardware();
    setPickerEnabled(true);
    $('record').hidden = true; $('preview-tag').hidden = true; $('video').hidden = true;
    if (!clip) $('empty').hidden = false;
    status(cameraErrorMessage(error), true);
    await refreshDeviceList();
  }
}
function capturePlan() {
  const video = $('video');
  return directCapturePlan({fps: Number($('fps').value), gifWidth: Number($('width').value), videoWidth: video.videoWidth, videoHeight: video.videoHeight});
}
function beginFrameCapture() {
  const plan = capturePlan();
  if (plan.tooLarge) { status('This live capture is too large for a GIF. Lower the frame rate or width and try again.', true); return false; }
  const video = $('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {alpha: false, willReadFrequently: true});
  if (!context) { status('This browser cannot capture frames from the camera. Try uploading a video.', true); return false; }
  let lockedHeight = plan.height, oversize = false;
  frameGrabber = createFrameGrabber({
    intervalMs: plan.intervalMs,
    maxFrames: plan.maxFrames,
    readFrame() {
      const frame = samplePreviewFrame(video, canvas, context, plan.width, lockedHeight);
      if (!frame) return null;
      if (!lockedHeight) lockedHeight = frame.height;
      if (frame.width * frame.height * plan.maxFrames > FRAME_PIXEL_BUDGET) { oversize = true; return null; }
      return frame;
    },
  });
  frameGrabber.oversize = () => oversize;
  frameGrabber.plan = plan;
  frameGrabber.start();
  $('record').hidden = false; $('record').textContent = '■ Stop recording';
  setPickerEnabled(false);
  status('Recording frames directly into a GIF… stops automatically after 5 seconds.');
  clearTimeout(timer);
  timer = setTimeout(() => { if (frameGrabber?.running) void finishDirectGif(frameGrabber.stop()); }, plan.maxFrames * plan.intervalMs + 50);
  return true;
}
async function finishDirectGif(frames) {
  clearTimeout(timer);
  const plan = frameGrabber?.plan || capturePlan();
  const oversize = frameGrabber?.oversize?.() || false;
  frameGrabber = undefined;
  releaseHardware();
  setPickerEnabled(true);
  $('record').hidden = true; $('record').textContent = '● Start recording'; $('preview-tag').hidden = true; $('video').hidden = true;
  if (oversize && !frames?.length) { status('This live capture is too large for a GIF. Lower the frame rate or width and try again.', true); return; }
  if (!frames?.length) { status('No frames were captured from this camera. Check the live preview and try again.', true); return; }
  const token = selectionVersion;
  $('record').disabled = true;
  status('Encoding the camera frames into a GIF…');
  try {
    const blob = await encodeCameraFrames(frames, {fps: plan.fps});
    if (token !== selectionVersion) return;
    clearResult();
    gifUrl = URL.createObjectURL(blob);
    $('gif').src = gifUrl; $('gif').hidden = false; $('video').hidden = true; $('still').hidden = true; $('empty').hidden = true;
    $('download').href = gifUrl; $('download').download = 'my-loop.gif'; $('download').hidden = false; $('convert').disabled = true;
    status(`Loop ready · Repeats continuously · ${(blob.size / 1024).toFixed(1)} KB · ${plan.fps} fps · ${plan.width} px · captured from the live camera`);
  } catch (error) {
    if (token !== selectionVersion) return;
    status(error.message || 'The camera frames could not be encoded.', true);
  } finally { if (token === selectionVersion) $('record').disabled = false; }
}
function discardRecorder(current) {
  if (!current) return;
  current.onstop = null; current.onerror = null; current.ondataavailable = null;
  if (current.state === 'recording') { try { current.stop(); } catch { /* already failed */ } }
}
function beginRecording() {
  if (!stream || busy || imageMode || recorder?.state === 'recording' || frameGrabber?.running) return;
  clearResult(); $('video').hidden = false; $('empty').hidden = true;
  const MediaRecorderImpl = window.MediaRecorder;
  const opened = openRecorder({
    MediaRecorder: MediaRecorderImpl,
    stream,
    isTypeSupported: typeof MediaRecorderImpl?.isTypeSupported === 'function' ? mime => MediaRecorderImpl.isTypeSupported(mime) : undefined,
  });
  if (!opened.ok) {
    if (!beginFrameCapture()) status('This camera could not start recording. Try uploading a video.', true);
    return;
  }
  recorder = opened.recorder;
  const mimeType = opened.mimeType || '';
  const chunks = []; recordingBytes = 0;
  recorder.ondataavailable = event => {
    if (!event.data?.size) return;
    chunks.push(event.data); recordingBytes += event.data.size;
    if (recordingBytes > MAX_BYTES && recorder?.state === 'recording') recorder.stop();
  };
  recorder.onerror = () => {
    if (recordingBytes > 0) { try { recorder.stop(); } catch { status('Recording failed. Please try again.', true); } return; }
    const failed = recorder; recorder = undefined; discardRecorder(failed);
    if (!beginFrameCapture()) status('This camera could not start recording. Try uploading a video.', true);
  };
  recorder.onstop = () => {
    clearTimeout(timer);
    const type = recorder?.mimeType || mimeType || 'video/webm';
    const file = chunks.length ? new File(chunks, recordingFilename(type), {type}) : null;
    stopCamera();
    if (!file) status('This camera did not produce any recorded video. Try recording again, or use a different camera.', true);
    else selectFile(file);
  };
  try { startRecorder(recorder, 250); }
  catch {
    const failed = recorder; recorder = undefined; discardRecorder(failed);
    if (!beginFrameCapture()) status('This camera could not start recording. Try uploading a video.', true);
    return;
  }
  $('record').textContent = '■ Stop recording';
  setPickerEnabled(false);
  status('Recording… stops automatically after 30 seconds.');
  timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, MEDIA_RECORDER_LIMIT_MS);
}
function selectFile(file) {
  if (busy || !file) return;
  const supported=imageMode?/\.(png|jpe?g|webp)$/i:/\.(mp4|mov|webm|avi|mkv|m4v)$/i;
  if (!supported.test(file.name)) return status(imageMode?'Choose a still PNG, JPEG, or WebP image.':'Choose an MP4, MOV, WebM, AVI, MKV or M4V video.', true);
  if (!file.size || file.size > (imageMode?20*1024*1024:MAX_BYTES)) return status(imageMode?'Choose a nonempty image smaller than 20 MiB.':'Choose a nonempty video smaller than 100 MiB.', true);
  selectionVersion++; activeJob?.abort();
  stopCamera(); clearResult(); clip = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  const video = $('video'); video.hidden=imageMode; $('still').hidden=!imageMode;
  if(imageMode) { editor.hide(); $('still').src=sourceUrl; }
  else {video.src = sourceUrl; video.muted = false; video.controls = true; editor.show();}
  $('empty').hidden = true; $('preview-tag').hidden = true; $('replace').hidden = false;
  $('filename').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB`;
  $('convert').disabled = false; $('convert').textContent=imageMode?'Animate image ↗':'Create GIF ↗'; $('upload-tab').classList.add('selected'); $('camera-tab').classList.remove('selected');
  status(imageMode?'Original loaded. Describe one motion, or choose an example.':'Ready when you are. Pick your settings and create a GIF.');
}
$('browse').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = e => { selectFile(e.target.files[0]); e.target.value = ''; };
$('upload-tab').onclick = () => { if (!busy) { stopCamera(); $('file').click(); } };
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.add('dragover');});
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.remove('dragover');});
$('dropzone').addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
$('camera-tab').onclick = () => { if (!busy && !stream && !imageMode) void startCamera({...DEFAULT_CAPTURE_IDEAL}); };
$('camera-device').onchange = () => {
  if (busy || recorder?.state === 'recording' || frameGrabber?.running) return;
  const deviceId = $('camera-device').value;
  activeFacing = '';
  updateFacingButtons();
  if (deviceId && deviceId === currentDeviceId()) return;
  void startCamera(deviceId ? {deviceId, ...DEFAULT_CAPTURE_IDEAL} : {...DEFAULT_CAPTURE_IDEAL});
};
function chooseFacing(facingMode) {
  if (busy || recorder?.state === 'recording' || frameGrabber?.running) return;
  activeFacing = facingMode; $('camera-device').value = ''; updateFacingButtons();
  void startCamera({facingMode, ...DEFAULT_CAPTURE_IDEAL});
}
$('facing-user').onclick = () => chooseFacing('user');
$('facing-environment').onclick = () => chooseFacing('environment');
$('record').onclick = () => {
  if (frameGrabber?.running) { void finishDirectGif(frameGrabber.stop()); return; }
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  beginRecording();
};
window.addEventListener('message', event => {
  if(event.origin !== location.origin || event.source !== $('settings').contentWindow) return;
  if(event.data?.type === 'gif-settings-ready') {syncSettings();return;}
  if(event.data?.type === 'gif-settings-unavailable') {$('advanced').open = true; return;}
  if(busy) return;
  const {type,setting,fps,width,duration} = event.data ?? {};
  if(type === 'gif-settings') {
    if(setting==='fps' && Number.isInteger(fps) && fps>=1 && fps<=30) $('fps').value=fps;
    if(setting==='width' && Number.isInteger(width) && width>=100 && width<=800) $('width').value=width;
    if(setting==='duration' && Number.isInteger(duration) && duration>=1 && duration<=6) $('duration').value=duration;
    syncSettings();
  }
});
// The iframe may finish before this module and its editor dependency load.
$('settings').contentWindow.postMessage({type:'gif-host-query'}, location.origin);
$('convert').onclick = async () => {
  if(!clip || busy) return;
  if(!$('fps').reportValidity() || !$('width').reportValidity()) return;
  if(imageMode && (!$('motion-prompt').reportValidity() || !$('duration').reportValidity())) return;
  const edits = imageMode ? null : editor.data();
  if (!imageMode && !edits) return status('Check the segment times and crop. Keep the selection within 5 seconds.', true);
  editor.stop();
  selectionVersion++; busy = true; $('convert').disabled = true;
  const controls=['camera-tab','upload-tab','replace','browse','animate-toggle','motion-prompt','duration','original-size','fps','width','video-editor','camera-device','facing-user','facing-environment'];
  for(const id of controls) $(id).disabled = true;
  document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=true);
  $('settings').inert=true;
  clearResult(); $('video').pause(); $('still').hidden=!imageMode; $('video').hidden=imageMode;
  activeJob?.abort();
  const job = activeJob = new AbortController();
  const fps = Number($('fps').value), width = Number($('width').value);
  status(imageMode?'Rendering your original image into a loop…':'Applying your edits and creating your loop…');
  try {
    const result = imageMode
      ? await animateImage({file: clip, prompt: $('motion-prompt').value.trim(), fps, width, duration: Number($('duration').value), originalSize: $('original-size').checked, signal: job.signal, onProgress: message => status(message)})
      : await convertVideo({video: $('video'), edits, fps, width, signal: job.signal, onProgress: message => status(message)});
    if (job.signal.aborted) return;
    const blob = result.blob;
    if (!blob.type.startsWith('image/gif')) throw new Error('The GIF could not be created. Please try again.');
    gifUrl = URL.createObjectURL(blob);
    $('gif').src = gifUrl; $('gif').hidden = false; $('video').hidden = $('still').hidden = true;
    $('download').href = gifUrl; $('download').download = 'my-loop.gif'; $('download').hidden = false;
    $('convert').textContent = 'Create another version ↗';
    status(`Loop ready · Repeats continuously · ${(blob.size/1024).toFixed(1)} KB · ${result.fps} fps · ${result.width} px`);
  } catch(error) { if (!job.signal.aborted) status(error.message || 'Unable to create the GIF.', true); }
  finally {busy = false; $('convert').disabled = !clip; $('convert').textContent = gifUrl ? 'Create another version ↗' : imageMode ? 'Animate image ↗' : 'Create GIF ↗'; for(const id of controls) $(id).disabled = false; document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=false); $('settings').inert=false;}
};
window.addEventListener('pagehide', event => {if(recorder) recorder.onstop = null; activeJob?.abort(); stopCamera(); if(!event.persisted){if(sourceUrl) URL.revokeObjectURL(sourceUrl); if(gifUrl) URL.revokeObjectURL(gifUrl);}});
