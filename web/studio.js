const $ = id => document.getElementById(id);
let clip, stream, recorder, sourceUrl, gifUrl, timer, busy = false, recordingBytes = 0;
const MAX_BYTES = 100 * 1024 * 1024;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearResult() {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = undefined; $('gif').hidden = true; $('download').hidden = true; $('convert').hidden = false;
}
function stopCamera() {
  clearTimeout(timer);
  if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); }
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  $('record').hidden = true; $('video').srcObject = null;
}
function selectFile(file) {
  if (busy || !file) return;
  if (!/\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(file.name)) return status('Choose an MP4, MOV, WebM, AVI, MKV or M4V video.', true);
  if (!file.size || file.size > MAX_BYTES) return status('Choose a nonempty video smaller than 100 MiB.', true);
  stopCamera(); clearResult(); clip = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  const video = $('video'); video.src = sourceUrl; video.muted = false; video.controls = true; video.hidden = false;
  $('empty').hidden = true; $('preview-tag').hidden = true; $('replace').hidden = false;
  $('filename').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB`;
  $('convert').disabled = false; $('upload-tab').classList.add('selected'); $('camera-tab').classList.remove('selected');
  status('Ready when you are. Pick your settings and create a GIF.');
}
$('browse').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = e => { selectFile(e.target.files[0]); e.target.value = ''; };
$('upload-tab').onclick = () => { if (!busy) { stopCamera(); $('file').click(); } };
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.add('dragover');});
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => {e.preventDefault(); $('dropzone').classList.remove('dragover');});
$('dropzone').addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
$('camera-tab').onclick = async () => {
  if (busy || stream) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return status('Camera recording is unavailable in this browser. Upload a clip instead.', true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
    clearResult(); clip = undefined; $('convert').disabled = true;
    $('video').srcObject = stream; $('video').muted = true; $('video').controls = false; $('video').hidden = false;
    await $('video').play(); $('empty').hidden = true; $('record').hidden = false; $('replace').hidden = true;
    $('preview-tag').hidden = false; $('record').textContent = '● Start recording';
    $('camera-tab').classList.add('selected'); $('upload-tab').classList.remove('selected');
    $('filename').textContent = 'Camera ready · 30-second limit'; status('Camera is ready. Start recording when you are.');
  } catch (error) { stopCamera(); status('Camera access failed. Check your browser permission or upload a video.', true); }
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
  if(event.data?.type === 'gif-settings-unavailable') {$('advanced').open = true; return;}
  const {type,fps,width} = event.data ?? {};
  if(type === 'gif-settings' && Number.isInteger(fps) && fps >= 1 && fps <= 30 && Number.isInteger(width) && width >= 100 && width <= 800) {
    $('fps').value = fps; $('width').value = width;
  }
});
$('convert').onclick = async () => {
  if(!clip || busy) return;
  if(!$('fps').reportValidity() || !$('width').reportValidity()) return;
  busy = true; $('convert').disabled = true;
  for(const id of ['camera-tab','upload-tab','replace','browse']) $(id).disabled = true;
  clearResult(); $('video').pause(); status('Creating your loop… larger clips can take up to two minutes.');
  const data = new FormData(); data.append('file',clip); data.append('fps',$('fps').value); data.append('width',$('width').value);
  try {
    const response = await fetch('/convert', {method:'POST',body:data,signal:AbortSignal.timeout(150000)});
    const result = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Conversion failed. Try a shorter video.');
    if(!/^output_[a-f0-9]{8,32}\.gif$/.test(result.filename)) throw new Error('The server returned an invalid download.');
    const download = await fetch(`/download/${encodeURIComponent(result.filename)}`);
    if(!download.ok) throw new Error('The GIF could not be downloaded. Please try again.');
    const blob = await download.blob(); gifUrl = URL.createObjectURL(blob);
    $('gif').src = gifUrl; $('gif').hidden = false; $('video').hidden = true;
    $('download').href = gifUrl; $('download').download = 'my-loop.gif'; $('download').hidden = false;
    // Keep conversion available to try a different recipe with the same source.
    $('convert').textContent = 'Create another version ↗';
    status(`Loop ready · ${(blob.size/1024).toFixed(1)} KB · ${result.fps} fps · ${result.width} px`);
  } catch(error) {status(error.name === 'TimeoutError' ? 'The server took too long. Try a shorter clip.' : error.message, true);}
  finally {busy = false; $('convert').disabled = false; for(const id of ['camera-tab','upload-tab','replace','browse']) $(id).disabled = false;}
};
window.addEventListener('pagehide', () => {if(recorder) recorder.onstop = null; stopCamera(); if(sourceUrl) URL.revokeObjectURL(sourceUrl); if(gifUrl) URL.revokeObjectURL(gifUrl);});
