# GIF Maker Live

A browser GIF studio with a GPUI WebAssembly settings panel. Upload a video or record your camera, trim and crop, or animate a still image, then download a looping GIF. Conversion runs **entirely in the browser**. A static host can serve `dist/` with no Render service, no proxy, and no cross-origin isolation headers.

## Still-image motion

**Loop GIF is always enabled.** Every generated GIF embeds infinite playback, so previews and downloaded files repeat continuously.

Turn on **Animate a still image**, choose a PNG/JPEG/WebP, and type one motion:

- `Gently float up and down`
- `Pan left` or `Pan right`
- `Zoom in and back out` or `Zoom out`
- `Gently rotate clockwise` or `Rotate counterclockwise`

GPUI provides FPS, output width, and image-loop duration presets; HTML controls provide keyboard input and a fallback when GPU rendering is unavailable. Duration is 1–6 seconds. Each motion returns to its starting point. This version animates the entire original image; it does not synthesize poses, segment subjects, repaint artwork, or accept arbitrary animation code. Unsupported/combined instructions return an actionable error instead of substituting a different motion.

**Keep original image size** is on by default. Float and pan use integer-pixel translations. Transparent padding keeps the complete source inside the canvas. Zoom and rotation are applied only when requested; resizing to the selected width requires turning original size off. EXIF orientation is normalized once. The page draws each frame on a canvas (the same sine in-out, yoyo motion the old GSAP timeline used) and encodes one global 256-color palette with no dithering. There is no lossy MP4/YUV intermediate. GIF limits output to 256 palette entries (one reserved for transparency) and binary transparency; photographic colors, soft alpha, resizing, zoom, and rotation cannot be pixel-identical to the source. No-dither output prioritizes stable pixels but can show banding on gradients.

Images are limited to 20 MiB / 20 million decoded pixels. Rendered frames are bounded to 1800px per side and 120 million pixels across the whole loop. Oversized original-size requests fail with a suggestion to opt into resizing or reduce FPS/duration; the page never silently downsizes them.

The optional FastAPI service still accepts `POST /animate` for callers that want the older HyperFrames/FFmpeg pipeline. The studio does not call it.

## Browser encoder

Video frames are grabbed by seeking the same `<video>` element used for preview, cropped, and scaled to the selected width. Still frames are drawn as described above. Both paths use `web/gif-encoder.js`:

- one median-cut palette for the whole loop
- Floyd–Steinberg dithering for video, none for still motion (so flat artwork does not shimmer)
- GIF89a with a Netscape loop count of 0

No SharedArrayBuffer, ffmpeg.wasm, or `COOP`/`COEP` headers are required. The encoder, motion renderer, and video grabber are about 28 KB of source (about 9 KB gzipped). Icons add about 18 KB. The service worker is about 2 KB. This replaces the previous upload/poll/download calls; `studio.js` itself got smaller. The studio works from a subpath such as `/technologies/gifmakerlive/` because every asset URL is relative.

Limits match the previous studio: source video up to 30 seconds and 100 MiB, joined GIF selection up to 5 seconds, 1–30 FPS, width 100–800. The browser must be able to decode the file in a `<video>` element (typically H.264 MP4, WebM, and the camera recording that same browser just produced). AVI, MKV, and some professional MOV files that FFmpeg used to accept will not import; the page says so instead of uploading them. Seeking is not always frame-accurate, and a long or high-FPS GIF is slower than the old FFmpeg job because each output frame is a seek. GIF delays are stored in centiseconds, so unusual frame rates are approximate. Very large loops can use a lot of memory; past about 80 million output pixels the page asks you to lower FPS or width.

## Architecture

- `web/studio.js`, `web/video-gif.js`, `web/motion.js`, `web/gif-encoder.js`: the studio. No runtime calls to `/convert`, `/animate`, or `/download`.
- `web/sw.js` and `web/manifest.webmanifest`: installable PWA. `start_url` and `scope` are `./`, and the service worker is registered with scope `./`, so a copy served at `/technologies/gifmakerlive/` does not control the rest of the host.
- `crates/studio`: GPUI (`gpui-pre` 0.3.8) browser controls. Browser-native media elements surround the GPU panel.
- `crates/gif-core`, `app.py`, `image_motion.py`, `video_edits.py`: optional HTTP API. The studio does not need them. They remain for the existing Python/Rust tests and for callers that still want a server.

## Run the studio locally

Any static file server rooted at `web/` (development) or `dist/` (production build) is enough. Camera capture needs HTTPS or localhost.

```sh
python scripts/serve_static.py --directory web --port 8776
# http://127.0.0.1:8776/
```

Build the GPU panel before deploying. Debug Wasm builds are large; use the optimized build for deployment. GPUI's `wasm_thread` dependency currently requires nightly. The host remains usable through custom controls if the GPU module cannot load.

```sh
rustup toolchain install nightly-2026-10-05 --profile minimal --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.121 --locked
# POSIX: export RUSTUP_TOOLCHAIN=nightly-2026-10-05
# PowerShell: $env:RUSTUP_TOOLCHAIN='nightly-2026-10-05'
python scripts/build_web.py
python scripts/serve_static.py --directory dist --port 8776
```

`scripts/build_web.py` copies `web/` to `dist/` and rewrites `dist/sw.js` with a content-hashed cache name and a relative precache list that includes HTML, JS, CSS, fonts, icons, and the Wasm panel. It then hardens the shipped JavaScript and WebAssembly in `dist/` so those release artifacts resist automated reverse-engineering analysis. Runtime behavior stays the same. That step needs Node.js 22.13+ or 24+ and npm.

## Installable app

The studio is a standalone PWA:

- `manifest.webmanifest` sets `name`, `short_name`, `display: standalone`, theme and background `#141717`, and both `any` and `maskable` icons at 192 and 512.
- `start_url` and `scope` are the relative URLs `./`. Resolved next to the manifest, they are exactly the studio directory.
- `sw.js` sits next to `index.html`. `index.html` registers it with `navigator.serviceWorker.register('sw.js', {scope: './', updateViaCache: 'none'})`.
- Install precaches the studio. A new `sw.js` (the build changes its cache name whenever an asset changes) skips waiting, claims clients, and deletes caches from older versions. Navigations try the network first and fall back to the cache, so a refresh picks up a new deploy while a previously opened studio still works offline.
- File upload and camera recording do not go through the network. `getUserMedia` still needs a secure context after install. The service worker ignores non-GET, cross-origin, and range requests, and it refuses to handle URLs outside its registration scope.

Serve `sw.js` and the manifest with `Cache-Control: no-cache`, and serve the manifest as `application/manifest+json`. `netlify.toml` does that for a Netlify publish of `dist/`. It no longer proxies API routes.

### Wrapping it as a desktop or mobile app later

Not implemented. The static `dist/` folder is the whole UI, which is what these wrappers want:

- **Tauri**: point the webview at `dist/`. No Rust conversion command is required for GIF creation. Allow media capture in the capability set. Tauri's custom protocol is a secure context, so `getUserMedia` can work, but service workers often do not run on `tauri://` or `asset://`. For a desktop build, either let the page run without the service worker or serve `dist/` from the tiny local static server Tauri can host. Blob downloads already work in the webview.
- **Capacitor**: copy `dist/` into the web asset directory. Add camera usage descriptions (`NSCameraUsageDescription` on iOS, `CAMERA` on Android) and inline playback. Android WebView supports service workers and `getUserMedia`. iOS WKWebView service-worker support is version-dependent; the page still functions when registration fails because registration errors are ignored.
- **Stores**: a Trusted Web Activity (PWABuilder / Bubblewrap) can list the HTTPS deployment on the Play Store once Digital Asset Links are published. The iOS App Store does not accept a PWA alone; use Capacitor or another native shell. The Microsoft Store can take the PWA directly.

## Optional conversion API

The Python service is unchanged for tests and for anyone who still wants FFmpeg on a server. It is not part of the static site.

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

The image renderer for that API needs Node 22+ (Docker uses 24), Chromium, FFmpeg and Pillow:

```sh
npm ci
npx hyperframes browser ensure
# Or set HYPERFRAMES_BROWSER_PATH to an installed Chrome Headless Shell executable (recommended on Windows).
```

The API uses only the pinned local CLI/GSAP packages and disables update/skill checks, automatic installation, and telemetry for render jobs. Prompts never enter HTML, JavaScript, subprocess command text, or URLs. `/health` reports whether the motion packages and Node are installed. Job status lives in memory for ten minutes and requires a single Uvicorn worker. `docs/validation.md` records the earlier server deploy; do not treat it as the current hosting plan.

## Verify

```sh
cargo test --locked -p gifmaker-core
pip install httpx
python -m unittest discover -s tests -v
cargo install weaveffi-cli --version 0.24.0 --locked
weaveffi generate crates/gif-core/src/lib.rs
git diff --exit-code -- bindings
```

API tests require the native library environment variable and FFmpeg. `tests/test_gif_encoder.py` checks the browser encoder with Pillow and does not start a server. Browser tests serve the static studio under a subpath and assert that no request hits `/convert`, `/animate`, or `/download`:

```sh
python scripts/serve_static.py --directory web --port 8776
# separate shell, after copying web/ to a subpath if you want that check:
GIFMAKER_TEST_URL=http://127.0.0.1:8776/ GIFMAKER_TEST_GPU_FALLBACK=1 \
GIFMAKER_TEST_IMAGE=/tmp/motion-fixture.png node tests/browser-motion.cjs
GIFMAKER_TEST_URL=http://127.0.0.1:8776/ node tests/browser-video.cjs
GIFMAKER_TEST_URL=http://127.0.0.1:8776/ node tests/browser-pwa.cjs
```

## Deployment

Publish `dist/` from `python scripts/build_web.py` (or `scripts/netlify_build.sh`) as static files. The production URL can be a subpath. No proxy to Render is required, and the host does not need `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`.

Camera capture needs HTTPS (or localhost). No production deployment is performed by the development scripts.

See [design references](docs/design.md) for modern styling options. The original PyQt prototype remains in `live.py` for reference.

## Video editing

Upload a video or record your camera, then use **Trim, splice & crop** before creating a GIF:

- Set segment start/end times in seconds. Add segments at the playhead to join multiple cuts in listed order (up to ten segments).
- Keep the combined selection at or below **5 seconds**. Source videos up to 30 seconds are supported within the existing 100 MiB limit; the initial selection is the first five seconds.
- Set crop left/top/width/height as percentages of the displayed video. The crop preview updates locally; **Play edited selection** previews the cuts in order. Output width is applied after cropping.
- Reset edits to return to the initial selection and full frame. Changing edits clears the previous GIF so you can generate a new version.

Edits never leave the page. The same rules as the old `edits` JSON apply, for example segments `[[0,2],[27,30]]` and crop `[0,0,50,100]` join five seconds and keep the left half. Without a custom selection, conversion uses the first five seconds (or the whole video if it is shorter). Recordings without duration metadata start with a five-second selection; the encoder measures the real length and fits that default selection when the recording is shorter. A source longer than 30 seconds is rejected even if the selection is short. A 50 ms duration tolerance accommodates container rounding.

Output width is the width chosen in the settings panel, applied after the crop, with the height chosen to keep the cropped aspect ratio. Scaling uses the canvas high-quality resampler rather than Lanczos.

Validation: `python -m unittest discover -s tests -p test_video_edits.py -v` still checks the optional FFmpeg preparation path. `node tests/browser-video.cjs` checks the browser upload, edit, in-browser GIF, camera recording, and mobile layout with no backend (set `GIFMAKER_TEST_URL` and optionally `GIFMAKER_TEST_BROWSER`). Both run in CI. `node tests/browser-pwa.cjs` checks the manifest, service-worker scope, and an offline reload.

### Optional editing guides

Toggle **Crop grid** to overlay rule-of-thirds lines on the crop preview, and **Editing tips** to show or hide instructions. The toggles are independent and keep your current segments, crop, and generated GIF intact. Guides are preview-only and are never encoded. Grid starts off; tips start on. Toggle choices last while the page stays open, including source replacement and switching modes.
