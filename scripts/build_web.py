"""Build the GPUI WebAssembly panel and copy static assets for Netlify."""
import argparse
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--debug", action="store_true")
args = parser.parse_args()
mode = "debug" if args.debug else "release"
command = ["cargo", "build", "--locked", "-p", "gifmaker-studio", "--target", "wasm32-unknown-unknown"]
if not args.debug:
    command.append("--release")
subprocess.run(command, cwd=root, check=True)
subprocess.run(["wasm-bindgen", str(root / f"target/wasm32-unknown-unknown/{mode}/gifmaker_studio.wasm"), "--target", "web", "--out-dir", str(root / "web/wasm")], check=True)
(root / "web/fonts").mkdir(exist_ok=True)
for path in (root / "crates/studio/fonts").iterdir():
    shutil.copy2(path, root / "web/fonts" / path.name)
shutil.copytree(root / "web", root / "dist", dirs_exist_ok=True)

