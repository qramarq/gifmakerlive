"""Fixed HyperFrames compositions, lossless PNG capture, and Rust GIF encoding.

Only a Rust-validated plan enters the template. Prompts are never executable HTML,
JavaScript, file names, URLs, or shell fragments.
"""
import json
import logging
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
import gifmaker_core as core

ROOT = Path(__file__).resolve().parent
CLI = ROOT / "node_modules/hyperframes/bin/hyperframes.mjs"
GSAP = ROOT / "node_modules/gsap/dist/gsap.min.js"
MAX_IMAGE_PIXELS = 20_000_000
MAX_FRAME_PIXELS = 120_000_000
RENDER_TIMEOUT = 100
log = logging.getLogger(__name__)


class MotionInputError(ValueError):
    pass


class MotionUnavailable(RuntimeError):
    pass


def available():
    return CLI.is_file() and GSAP.is_file() and bool(shutil.which("node"))


def geometry(width, height, plan):
    effect = plan["effect"]
    amount = 0.02 if plan["gentle"] else 0.04
    dx, dy = max(2, round(width * amount)), max(2, round(height * amount))
    pad_x = pad_y = 2
    if effect == "float":
        pad_y += dy
        transform = {"y": -dy}
    elif effect in {"pan-left", "pan-right"}:
        pad_x += dx
        transform = {"x": dx * (-1 if effect == "pan-left" else 1)}
    elif effect in {"zoom-in", "zoom-out"}:
        scale = 1 + amount * (2 if effect == "zoom-in" else -2)
        pad_x += math.ceil(width * max(0, scale - 1) / 2)
        pad_y += math.ceil(height * max(0, scale - 1) / 2)
        transform = {"scale": scale}
    else:
        degrees = 3 if plan["gentle"] else 6
        radians = math.radians(degrees)
        pad_x += math.ceil(max(0, height * math.sin(radians) + width * math.cos(radians) - width) / 2)
        pad_y += math.ceil(max(0, width * math.sin(radians) + height * math.cos(radians) - height) / 2)
        transform = {"rotation": degrees * (-1 if effect == "rotate-ccw" else 1)}
    return width + 2 * pad_x, height + 2 * pad_y, pad_x, pad_y, transform


def prepare(source, project, plan, fps, duration, width, original_size):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as uploaded:
                if uploaded.format not in {"PNG", "JPEG", "WEBP"} or getattr(uploaded, "n_frames", 1) != 1:
                    raise MotionInputError("Choose a single still PNG, JPEG, or WebP image")
                if uploaded.width * uploaded.height > MAX_IMAGE_PIXELS:
                    raise MotionInputError("Choose an image with at most 20 million pixels")
                image = ImageOps.exif_transpose(uploaded).convert("RGBA")
                if not original_size:
                    # Resizing is explicitly chosen in the UI; never upscale a small source.
                    new_width = min(width, image.width)
                    image = image.resize((new_width, max(1, round(image.height * new_width / image.width))), Image.Resampling.LANCZOS)
                iw, ih = image.size
                cw, ch, left, top, transform = geometry(iw, ih, plan)
                if cw > 1800 or ch > 1800 or cw * ch * fps * duration > MAX_FRAME_PIXELS:
                    raise MotionInputError("Image and loop are too large. Turn off original size, choose a smaller width, or reduce FPS/duration")
                image.save(project / "source.png")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise MotionInputError("This image cannot be decoded safely. Choose a smaller valid PNG, JPEG, or WebP") from error
    values = dict(WIDTH=cw, HEIGHT=ch, IMAGE_WIDTH=iw, IMAGE_HEIGHT=ih, LEFT=left, TOP=top,
                  DURATION=duration, FPS=fps, TRANSFORM=json.dumps(transform))
    html = (ROOT / "motion/template.html").read_text(encoding="utf-8")
    for key, value in values.items():
        html = html.replace("{{" + key + "}}", str(value))
    (project / "index.html").write_text(html, encoding="utf-8")
    shutil.copyfile(GSAP, project / "gsap.min.js")
    return cw, ch


def run_renderer(project, frames, fps):
    env = dict(os.environ, HYPERFRAMES_NO_UPDATE_CHECK="1", HYPERFRAMES_NO_AUTO_INSTALL="1",
               HYPERFRAMES_SKIP_SKILLS="1", DO_NOT_TRACK="1")
    command = [shutil.which("node"), str(CLI), "render", str(project), "--format", "png-sequence",
               "--output", str(frames), "--fps", str(fps), "--workers", "1", "--strict",
               "--low-memory-mode", "--experimental-fast-capture=false", "--frames-cache-dir", "off"]
    # A process group lets a deadline stop Chromium/FFmpeg children as well.
    with (project / "render.log").open("w+b") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=env,
                                   start_new_session=os.name != "nt", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            result = process.wait(timeout=RENDER_TIMEOUT)
        except subprocess.TimeoutExpired as error:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            output.seek(0, 2)
            output.seek(max(0, output.tell() - 4000))
            log.error("HyperFrames timed out: %s", output.read().decode("utf-8", errors="replace"))
            raise MotionUnavailable("Image rendering timed out. Try a smaller image or shorter loop") from error
        if result:
            output.seek(0, 2)
            output.seek(max(0, output.tell() - 4000))
            log.error("HyperFrames failed: %s", output.read().decode("utf-8", errors="replace"))
            raise MotionUnavailable("The image renderer could not finish. Please try again or use a smaller image")


def animate(source, destination, prompt, fps, width, duration, original_size):
    if not 1 <= fps <= 30 or not 100 <= width <= 800 or not 1 <= duration <= 6:
        raise MotionInputError("Use 1–30 FPS, 100–800 pixels, and a 1–6 second loop")
    plan = json.loads(core.plan_motion(prompt))
    if not available():
        raise MotionUnavailable("Image motion is not installed on this server yet")
    with tempfile.TemporaryDirectory(prefix="motion-", dir=source.parent) as temporary:
        project = Path(temporary)
        cw, ch = prepare(source, project, plan, fps, duration, width, original_size)
        frames = project / "frames"
        run_renderer(project, frames, fps)
        # Normalize HyperFrames' public PNG-sequence output to the FFI contract.
        captures = sorted(frames.glob("*.png"))
        count = fps * duration
        if len(captures) != count:
            raise MotionUnavailable("The renderer returned an incomplete frame sequence")
        normalized = project / "encode"
        normalized.mkdir()
        for index, frame in enumerate(captures):
            frame.rename(normalized / f"frame_{index:06}.png")
        size = core.encode_motion(str(normalized), str(destination), fps, count)
    return {"width": cw, "height": ch, "bytes": size, "motion": plan["effect"], "duration": duration}
