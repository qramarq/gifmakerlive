// Edits stay local until Create GIF; the source file is never modified.
export function createVideoEditor(video, panel, onEdit) {
  let segments = [], duration = 0, playing = false, active = 0;
  const rows = panel.querySelector('#segments');
  const canvas = panel.querySelector('canvas');
  const context = canvas.getContext('2d');
  const cropInputs = [...panel.querySelectorAll('[data-crop]')];
  const summary = panel.querySelector('#edit-summary');
  const preview = panel.querySelector('#preview-edit');
  function crop() { return cropInputs.map(input => Number(input.value)); }
  function valid() {
    const total = segments.reduce((sum, [start, end]) => sum + end - start, 0);
    const [x, y, w, h] = crop();
    const ok = segments.length > 0 && segments.every(([start, end]) =>
      Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && (!duration || end <= duration + .001)) &&
      total <= 5 + 1e-9 && cropInputs.every(input => input.validity.valid) && x + w <= 100 && y + h <= 100;
    summary.textContent = ok ? `${total.toFixed(2)} / 5 seconds · Segments play in listed order` : 'Use valid segments totaling up to 5 seconds and a crop inside the video.';
    summary.classList.toggle('error', !ok);
    preview.disabled = !ok;
    return ok;
  }
  function draw() {
    if (panel.hidden || !video.videoWidth || video.readyState < 2) return;
    const [x, y, w, h] = crop();
    if (w <= 0 || h <= 0 || x + w > 100 || y + h > 100) return;
    const sw = video.videoWidth * w / 100, sh = video.videoHeight * h / 100;
    canvas.width = Math.min(640, sw); canvas.height = Math.min(640, sw) * sh / sw;
    context.drawImage(video, video.videoWidth * x / 100, video.videoHeight * y / 100, sw, sh, 0, 0, canvas.width, canvas.height);
  }
  function changed() { playing = false; video.pause(); valid(); draw(); onEdit(); }
  function render() {
    rows.replaceChildren();
    segments.forEach((segment, index) => {
      const row = document.createElement('div'); row.className = 'segment-row';
      ['Start', 'End'].forEach((name, field) => {
        const label = document.createElement('label'); label.textContent = `${name} ${index + 1} (s)`;
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '0.01'; input.required = true;
        if (duration) input.max = String(duration);
        input.value = segment[field];
        input.oninput = () => { segment[field] = input.value === '' ? NaN : Number(input.value); changed(); if (field === 0 && Number.isFinite(segment[0])) video.currentTime = segment[0]; };
        label.append(input); row.append(label);
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = segments.length === 1;
      remove.setAttribute('aria-label', `Remove segment ${index + 1}`);
      remove.onclick = () => { segments.splice(index, 1); render(); changed(); };
      row.append(remove); rows.append(row);
    });
    panel.querySelector('#add-segment').disabled = segments.length >= 10;
    valid();
  }
  panel.querySelector('#add-segment').onclick = () => {
    const start = Math.min(video.currentTime || 0, Math.max(0, duration - .1));
    segments.push([Number(start.toFixed(2)), Number(Math.min(start + 1, duration || start + 1).toFixed(2))]); render(); changed();
  };
  panel.querySelector('#reset-edit').onclick = () => { reset(); onEdit(); };
  cropInputs.forEach(input => input.oninput = changed);
  preview.onclick = async () => {
    if (!valid()) return;
    onEdit(); active = 0; playing = true; video.currentTime = segments[0][0];
    try { await video.play(); } catch { playing = false; }
  };
  function tick() {
    if (playing && (video.currentTime >= segments[active][1] - .015 || video.ended)) {
      active++;
      if (active === segments.length) { playing = false; video.pause(); }
      else { video.currentTime = segments[active][0]; video.play().catch(() => { playing = false; }); }
    }
    draw();
  }
  video.addEventListener('timeupdate', tick);
  video.addEventListener('seeked', draw);
  video.addEventListener('loadeddata', draw);
  // Draw each displayed frame while playing, without a persistent animation loop.
  if (video.requestVideoFrameCallback) {
    const frame = () => { tick(); video.requestVideoFrameCallback(frame); };
    video.requestVideoFrameCallback(frame);
  }
  function reset() {
    playing = false; video.pause();
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    segments = [[0, Math.min(5, duration || 5)]];
    cropInputs.forEach((input, index) => input.value = index < 2 ? 0 : 100);
    render(); draw();
  }
  video.addEventListener('loadedmetadata', () => { if (!video.srcObject) reset(); });
  return {
    show() { panel.hidden = false; reset(); },
    hide() { panel.hidden = true; playing = false; },
    data() { return valid() ? {segments, crop: crop()} : null; },
    stop() { playing = false; video.pause(); },
  };
}
