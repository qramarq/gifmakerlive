import { createVideoEditor } from "./video-editor.js";
import { animateImage } from "./motion.js";
import { convertVideo } from "./video-gif.js";
const $ = id => document.getElementById(id);
let clip, stream, recorder, sourceUrl, gifUrl, timer, busy = false, recordingBytes = 0;
let imageMode = false, selectionVersion = 0, activeJob;
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
function stopCamera() {
  selectionVersion++;
  clearTimeout(timer);
  if (recorder) { recorder.onstop = null; if (recorder.state === 'recording') recorder.stop(); }
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  $('record').hidden = true; $('video').srcObject = null;
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
$('camera-tab').onclick = async () => {
  if (busy || stream || imageMode) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return status('Camera recording is unavailable in this browser. Upload a clip instead.', true);
  const version=++selectionVersion;
  try {
    const camera=await navigator.mediaDevices.getUserMedia({video: true, audio: false});
    if(version!==selectionVersion || imageMode || busy){camera.getTracks().forEach(track=>track.stop());return;}
    stream = camera;
    clearResult(); editor.hide(); clip = undefined; $('convert').disabled = true;
    $('video').srcObject = stream; $('video').muted = true; $('video').controls = false; $('video').hidden = false;
    await $('video').play();
    if(version!==selectionVersion || imageMode || busy){camera.getTracks().forEach(track=>track.stop());return;}
    $('empty').hidden = true; $('record').hidden = false; $('replace').hidden = true;
    $('preview-tag').hidden = false; $('record').textContent = '● Start recording';
    $('camera-tab').classList.add('selected'); $('upload-tab').classList.remove('selected');
    $('filename').textContent = 'Camera ready · 30-second limit'; status('Camera is ready. Start recording when you are.');
  } catch (error) { if(version===selectionVersion){stopCamera(); status('Camera access failed. Check your browser permission or upload a video.', true);} }
};
$('record').onclick = () => {
  if (recorder?.state === 'recording') {recorder.stop(); return;}
  try {
    const mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('No supported recording format');
    recorder = new MediaRecorder(stream, {mimeType});
    const chunks = []; recordingBytes = 0;
    recorder.ondataavailable = e => {if(e.data.size){chunks.push(e.data); recordingBytes += e.data.size; if(recordingBytes > MAX_BYTES && recorder.state === 'recording') recorder.stop();}};
    recorder.onerror = () => {stopCamera(); status('Recording failed. Please try again.', true);};
    recorder.onstop = () => {clearTimeout(timer); const file = new File(chunks, `camera.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, {type:mimeType}); stopCamera(); selectFile(file);};
    recorder.start(250); $('record').textContent = '■ Stop recording'; status('Recording… stops automatically after 30 seconds.');
    timer = setTimeout(() => {if(recorder.state === 'recording') recorder.stop();}, 30000);
  } catch(error) {stopCamera(); status('This camera could not start recording. Try uploading a video.', true);}
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
  const controls=['camera-tab','upload-tab','replace','browse','animate-toggle','motion-prompt','duration','original-size','fps','width','video-editor'];
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
