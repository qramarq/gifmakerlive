# Rebuild validation — October 5, 2026

> Historical record of the server-backed rebuild. The browser studio now encodes GIFs on device and does not need the Render service described below.

Implemented in `codex/gpui-weaveffi-rebuild`. No production deployment has been made. The owner-approved review-branch exception is recorded below.

## Verified locally

- Rust conversion tests passed (2): real FFmpeg conversion, dimensions, invalid options/input, and failed-output cleanup.
- Generated WeaveFFI Python binding/FastAPI tests passed (3): upload, conversion, GIF download, loop extension, dimensions, errors, upload limit and temporary-upload cleanup.
- WeaveFFI regeneration reports zero added, removed or modified files.
- The GPUI browser module compiled and rendered in headless Edge. Clicking a preset updated the browser's submitted conversion settings.
- Browser upload → Rust conversion → GIF preview/download passed.
- Browser synthetic camera → MediaRecorder → Rust conversion → GIF preview/download passed. This is not a physical webcam verification.
- A 390px mobile viewport had no horizontal overflow. Physical mobile devices and Safari have not been tested.
- Blocking the GPU module still allowed conversion through the HTML custom controls at 24 FPS and 720px.

## Build limits

The machine had little free disk space. A workspace-local Rust 1.99.0 toolchain built the native library. Local Wasm validation used `RUSTC_BOOTSTRAP=wasm_thread` solely to enable that dependency's required compiler feature without installing a second toolchain. The documented build and CI use nightly-2026-10-05 instead; that path has not run locally.

The debug Wasm build succeeds. Optimized builds exhausted disk space, including a retry without link-time optimization. Optimized packaging remains unverified and should pass CI before release. Generated Wasm/native binaries and build caches are excluded from Git.

## GitHub publication

The initial push was rejected by active ruleset `marq` (ID 11077202), which restricted creation and updates on all branches and required verified signatures. With explicit owner approval, only `refs/heads/codex/*` was added to the ruleset exclusions. The ruleset remains active, and the effective rules on `main` were verified unchanged. The review branch is now pushed.

Optimized packaging and the pinned nightly build still need successful CI before release. Existing review and scanning requirements on `main` continue to apply.

## Deployment gate

These notes describe an earlier server-backed studio. `render.yaml`, `Dockerfile`, and `.dockerignore` have been removed. The Python API remains for local tests and is not deployed. Static hosting of `dist/` is the current plan. Container deployment, production routing, and HTTPS camera checks were not verified.
