# GIF Maker Live

A browser GIF studio with a GPUI WebAssembly settings panel and a Rust conversion core exposed through WeaveFFI 0.24.0. Upload a video or record your camera, choose FPS/width, preview and download a looping GIF.

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

Netlify builds the Wasm UI and proxies `/convert`, `/download/*`, and `/health` to the existing Render service. The conversion backend must migrate from its current Python runtime to the supplied Docker image; a repository merge alone does not change an existing Render service's runtime. Deploy and verify the Docker backend before promoting the new UI. `/health` must report `engine: rust-weaveffi`.

The Docker backend serves the browser host as well, but its GPU files are produced by the separate Netlify build. Camera capture needs HTTPS (or localhost). No production deployment is performed by the development scripts.

Uploads are deleted after each job. GIFs remain until server storage is cleared. Add retention cleanup and an ingress/body-size policy before operating at substantial public scale. The 100 MiB limit is enforced during application upload streaming; the multipart parser may spool request bodies before the route runs. Timeout/cancellation of a browser request does not cancel an already-running conversion; the encoder retains its server-side 120-second limit.

See [design references](docs/design.md) for modern styling options. The original PyQt prototype remains in `live.py` for reference.
