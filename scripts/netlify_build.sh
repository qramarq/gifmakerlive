#!/usr/bin/env bash
set -euo pipefail
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
source "$HOME/.cargo/env"
rustup toolchain install nightly-2026-10-05 --profile minimal --target wasm32-unknown-unknown
export RUSTUP_TOOLCHAIN=nightly-2026-10-05
cargo install wasm-bindgen-cli --version 0.2.121 --locked
python3 scripts/build_web.py

