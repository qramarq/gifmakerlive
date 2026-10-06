# GIF Maker Live

A browser GIF studio with a GPUI WebAssembly settings panel and a Rust conversion core exposed through WeaveFFI 0.24.0. Upload a video or record your camera, choose FPS/width, preview and download a looping GIF.

## Still-image motion

**Loop GIF is always enabled.** Every generated GIF embeds infinite playback, so previews and downloaded files repeat continuously.

Turn on **Animate a still image**, choose a PNG/JPEG/WebP, and type one motion:

- `Gently float up and down`
- `Pan left` or `Pan right`
- `Zoom in and back out` or `Zoom out`
- `Gently rotate clockwise` or `Rotate counterclockwise`

GPUI provides FPS, output width, and image-loop duration presets; HTML controls provide keyboard input and a fallback when GPU rendering is unavailable. Duration is 1–6 seconds. Each motion returns to its starting point. This version animates the entire original image; it does not synthesize poses, segment subjects, repaint artwork, or accept arbitrary animation code. Unsupported/combined instructions return an actionable error instead of substituting a different motion.

**Keep original image size** is on by default. Float and pan use integer-pixel translations. Transparent padding keeps the complete source inside the canvas. Zoom/rotation are only applied when explicitly requested; resizing to the selected width requires turning original size off. EXIF orientation is normalized once. HyperFrames 0.8.134 captures lossless RGBA PNG frames, then the Rust core calls FFmpeg directly on those frames with one global palette and no dithering. There is no lossy MP4/YUV intermediate. GIF limits output to 256 palette entries (one reserved for transparency) and binary transparency; photographic colors, soft alpha, resizing, zoom, and rotation cannot be pixel-identical to the source. No-dither output prioritizes stable pixels but can show banding on gradients.

Images are limited to 20 MiB / 20 million decoded pixels. Rendered frames are bounded to 1800px per side and 120 million pixels across the whole loop. Oversized original-size requests fail with a suggestion to opt into resizing or reduce FPS/duration; the server never silently downsizes them.

`POST /animate` accepts multipart `file`, `prompt`, `fps`, `width`, `duration`, and `original_size`, returning HTTP 202 with `job_id`. Poll `GET /animate/{job_id}` for queued/rendering/ready/failed status; ready jobs include the ordinary GIF `filename`. Four uploads/jobs may be pending, one image render runs at a time, and video conversion remains available. Job status lives in memory for ten minutes and requires a **single Uvicorn worker/service instance** (the supplied Docker default). Restarted/expired jobs return an actionable 404; horizontal scaling needs a shared job store. Rendering has a 100-second deadline that stops its process tree; the Rust encoder retains its separate 120-second deadline. Sources and intermediate PNG frames are deleted on success and handled failures.

The image renderer needs Node 22+ (Docker uses 24), Chromium, FFmpeg and Pillow. After the ordinary Rust/Python setup below:

```sh
npm ci
npx hyperframes browser ensure
# Or set HYPERFRAMES_BROWSER_PATH to an installed Chrome Headless Shell executable (recommended on Windows).
```

The backend uses only the pinned local CLI/GSAP packages and disables update/skill checks, automatic installation, and telemetry for render jobs. Prompts never enter HTML, JavaScript, subprocess command text, or URLs. `/health` reports whether the motion packages and Node are installed; a successful integration render is the readiness check for Chromium/FFmpeg. Keep at least 1 GiB free for HyperFrames' preflight check, with additional space for the job's frames.

## Architecture

- `crates/gif-core`: validates conversion options and runs FFmpeg with palette optimization, a 120-second timeout and atomic output publication.
- `bindings`: generated Python and C bindings. FastAPI calls the Rust library by default; there is no Python encoder fallback.
- `crates/studio`: GPUI (`gpui-pre` 0.3.8) browser controls. Browser-native media elements surround the GPU panel; this is a hybrid browser UI, not a standalone desktop app.
- `web`: responsive charcoal/lime studio, camera/file bridge, previews, accessible custom controls and downloads.
- `app.py`: bounded streaming uploads, a two-job conversion semaphore, threaded FFI calls, errors and download routes.

## Run locally

Install Rust, Python 3.13+, FFmpeg, and a C linker. Keep FFmpeg on PATH.

```sh
cargo build --locked -p gifmaker-core
python -m venv .venv
# Activate .venv for your shell.
pip install -r requirements.txt ./bindings/python
# Linux:
export GIFMAKER_CORE_LIBRARY="$PWD/target/debug/libgifmaker_core.so"
# Windows PowerShell: $env:GIFMAKER_CORE_LIBRARY="$PWD\target\debug\gifmaker_core.dll"
uvicorn app:app --host 127.0.0.1 --port 8000
```

Build the browser UI before opening the app:

```sh
rustup toolchain install nightly-2026-10-05 --profile minimal --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.121 --locked
# POSIX: export RUSTUP_TOOLCHAIN=nightly-2026-10-05
# PowerShell: $env:RUSTUP_TOOLCHAIN='nightly-2026-10-05'
python scripts/build_web.py
```

GPUI's `wasm_thread` dependency currently requires nightly. The host remains usable through custom controls if the GPU module cannot load. Debug Wasm builds are large; use the optimized build for deployment.

## Verify

```sh
cargo test --locked -p gifmaker-core
pip install httpx
python -m unittest discover -s tests -v
cargo install weaveffi-cli --version 0.24.0 --locked
weaveffi generate crates/gif-core/src/lib.rs
git diff --exit-code -- bindings
```

Tests require the native library environment variable and FFmpeg. They exercise generated bindings, real conversion, dimensions, invalid files/options, upload size enforcement and cleanup.

## Deployment

Netlify builds the Wasm UI and proxies `/convert`, `/animate`, `/animate/*`, `/download/*`, and `/health` to the existing Render service. The conversion backend must migrate from its current Python runtime to the supplied Docker image; a repository merge alone does not change an existing Render service's runtime. Deploy and verify the Docker backend before promoting the new UI. `/health` must report `engine: rust-weaveffi`.

The Docker backend serves the browser host as well, but its GPU files are produced by the separate Netlify build. Camera capture needs HTTPS (or localhost). No production deployment is performed by the development scripts.

Uploads are deleted after each job. GIFs remain until server storage is cleared. Add retention cleanup and an ingress/body-size policy before operating at substantial public scale. The 100 MiB limit is enforced during application upload streaming; the multipart parser may spool request bodies before the route runs. Timeout/cancellation of a browser request does not cancel an already-running conversion; the encoder retains its server-side 120-second limit.

See [design references](docs/design.md) for modern styling options. The original PyQt prototype remains in `live.py` for reference.
