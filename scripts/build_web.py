"""Build the GPUI WebAssembly panel and copy static assets for static hosting."""
import argparse
import hashlib
import re
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
RUNTIME_SUFFIXES = {".html", ".css", ".js", ".webmanifest", ".png", ".ttf", ".wasm", ".woff", ".woff2", ".svg", ".ico", ".webp"}
HARDEN_SUFFIXES = {".js", ".mjs", ".cjs", ".wasm"}
BLA_PACKAGE = "bla-agents@1.1.0"


def precache_urls(dist: Path) -> list[str]:
    urls = []
    for path in dist.rglob("*"):
        if not path.is_file() or path.name == "sw.js" or path.suffix.lower() not in RUNTIME_SUFFIXES:
            continue
        urls.append("./" + path.relative_to(dist).as_posix())
    rest = sorted(url for url in urls if url not in {"./index.html"})
    if "./index.html" not in urls:
        raise SystemExit("dist is missing index.html")
    return ["./", "./index.html", *rest]


def cache_version(dist: Path, urls: list[str]) -> str:
    digest = hashlib.sha256()
    for url in urls:
        digest.update(url.encode())
        if url == "./":
            continue
        digest.update((dist / url[2:]).read_bytes())
    return "gifmaker-live-" + digest.hexdigest()[:16]


def write_precache(dist: Path) -> str:
    urls = precache_urls(dist)
    version = cache_version(dist, urls)
    sw_path = dist / "sw.js"
    source = sw_path.read_text(encoding="utf-8")
    source, cache_count = re.subn(r'const CACHE = ".*?";', f'const CACHE = "{version}";', source, count=1)
    block = "const PRECACHE = [\n" + "".join(f'  "{url}",\n' for url in urls) + "];"
    source, list_count = re.subn(r"const PRECACHE = \[[\s\S]*?\];", block, source, count=1)
    if cache_count != 1 or list_count != 1:
        raise SystemExit("service worker is missing CACHE or PRECACHE")
    if any(url.startswith("/") for url in urls):
        raise SystemExit("precache URLs must stay relative")
    sw_path.write_text(source, encoding="utf-8")
    return version


def node_version() -> tuple[int, int]:
    try:
        raw = subprocess.check_output(["node", "-p", "process.versions.node"], text=True).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit("Node.js 22.13+ or 24+ is required to harden the release") from error
    major, minor, *_rest = (int(part) for part in raw.split("."))
    if not ((major == 22 and minor >= 13) or major >= 24):
        raise SystemExit(f"Node.js 22.13+ or 24+ is required to harden the release (found {raw})")
    return major, minor


def ensure_bla() -> Path:
    node_version()
    prefix = root / ".cache" / "bla-agents"
    index = prefix / "node_modules" / "bla-agents" / "dist" / "index.js"
    if not index.is_file():
        prefix.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["npm", "install", "--prefix", str(prefix), "--no-audit", "--no-fund", BLA_PACKAGE],
            check=True,
        )
    if not index.is_file():
        raise SystemExit("bla-agents did not install")
    return index


def release_artifacts(dist: Path, skip_names: set[str] | None = None) -> list[Path]:
    skip = skip_names or set()
    files = []
    for path in sorted(dist.rglob("*")):
        if not path.is_file() or path.name in skip or path.suffix.lower() not in HARDEN_SUFFIXES:
            continue
        if ".hardened." in path.name:
            continue
        files.append(path)
    return files


def harden_paths(paths: list[Path]) -> None:
    if not paths:
        return
    subprocess.run(
        ["node", str(root / "scripts" / "harden_release.mjs"), str(ensure_bla()), *map(str, paths)],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    mode = "debug" if args.debug else "release"
    command = ["cargo", "build", "--locked", "-p", "gifmaker-studio", "--target", "wasm32-unknown-unknown"]
    if not args.debug:
        command.append("--release")
    subprocess.run(command, cwd=root, check=True)
    subprocess.run(
        ["wasm-bindgen", str(root / f"target/wasm32-unknown-unknown/{mode}/gifmaker_studio.wasm"), "--target", "web", "--out-dir", str(root / "web/wasm")],
        check=True,
    )
    (root / "web/fonts").mkdir(exist_ok=True)
    for path in (root / "crates/studio/fonts").iterdir():
        if path.is_file():
            shutil.copy2(path, root / "web/fonts" / path.name)
    dist = root / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(root / "web", dist)
    harden_paths(release_artifacts(dist, {"sw.js"}))
    version = write_precache(dist)
    harden_paths([dist / "sw.js"])
    print(f"Wrote {dist / 'sw.js'} ({version})")


if __name__ == "__main__":
    main()
