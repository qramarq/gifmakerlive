"""HTTP and browser adapter for the WeaveFFI Rust conversion core."""
import asyncio
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
import gifmaker_core as core
import image_motion

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.environ.get("GIFMAKER_UPLOAD_DIR", BASE_DIR / "uploads"))
OUTPUT_DIR = Path(os.environ.get("GIFMAKER_OUTPUT_DIR", BASE_DIR / "output"))
for directory in (UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="GIF Maker Live", version="2.0.0")
conversion_slots = asyncio.Semaphore(2)
motion_slots = asyncio.Semaphore(1)
MAX_BYTES = 100 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
motion_jobs = {}

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "gif-maker-live", "engine": "rust-weaveffi",
            "image_motion": {"installed": image_motion.available(), "renderer": "hyperframes", "version": "0.8.134"}}

@app.post("/animate", status_code=202)
async def animate_image(background: BackgroundTasks, file: UploadFile = File(...), prompt: str = Form(...),
                        fps: int = Form(10), width: int = Form(320),
                        duration: int = Form(4), original_size: bool = Form(True)):
    job = uuid.uuid4().hex
    source = UPLOAD_DIR / (job + ".image")
    filename = f"output_{job}.gif"
    accepted = False
    try:
        for old_job, state in list(motion_jobs.items()):
            if state.get("expires", float("inf")) < time.monotonic():
                del motion_jobs[old_job]
        if sum(state["status"] in {"uploading", "queued", "rendering"} for state in motion_jobs.values()) >= 4:
            raise HTTPException(503, "The image renderer is busy. Please try again shortly")
        if not 1 <= fps <= 30 or not 100 <= width <= 800 or not 1 <= duration <= 6 or fps * duration < 2:
            raise HTTPException(422, "Use 1–30 FPS, 100–800 pixels, and a 1–6 second loop with at least two frames")
        # Validate even before writing an upload. The same Rust planner is used by the worker.
        core.plan_motion(prompt)
        if Path(file.filename or "").suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise HTTPException(400, "Choose a still PNG, JPEG, or WebP image")
        motion_jobs[job] = {"status": "uploading"}
        total = 0
        with source.open("xb") as stream:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise HTTPException(413, "Maximum image upload size is 20 MiB")
                stream.write(chunk)
        if not total:
            raise HTTPException(400, "The image is empty")
        motion_jobs[job] = {"status": "queued"}
        background.add_task(render_image_job, job, source, filename, prompt, fps, width, duration, original_size)
        accepted = True
        return {"job_id": job, "status": "queued"}
    except core.ConversionError as error:
        status = 422 if isinstance(error, (core.InvalidInput, core.InvalidOptions, core.EncodingFailed, core.UnsupportedMotion)) else 503
        raise HTTPException(status, str(error)) from error
    finally:
        if not accepted:
            motion_jobs.pop(job, None)
            source.unlink(missing_ok=True)
        await file.close()


async def render_image_job(job, source, filename, prompt, fps, width, duration, original_size):
    try:
        async with motion_slots, conversion_slots:
            motion_jobs[job] = {"status": "rendering"}
            result = await run_in_threadpool(image_motion.animate, source, OUTPUT_DIR / filename,
                                            prompt, fps, width, duration, original_size)
        motion_jobs[job] = {"status": "ready", "filename": filename, "fps": fps,
                            "file_size": f"{result.pop('bytes') / 1024:.1f} KB", **result}
    except (image_motion.MotionInputError, image_motion.MotionUnavailable, core.ConversionError) as error:
        motion_jobs[job] = {"status": "failed", "detail": str(error)}
    except Exception:
        image_motion.log.exception("Image motion job failed")
        motion_jobs[job] = {"status": "failed", "detail": "The image renderer is unavailable. Please try again"}
    finally:
        source.unlink(missing_ok=True)
        motion_jobs[job]["expires"] = time.monotonic() + 600


@app.get("/animate/{job}")
async def motion_status(job: str):
    state = motion_jobs.get(job)
    if not state or state.get("expires", float("inf")) < time.monotonic():
        raise HTTPException(404, "This motion job has expired or the server restarted. Please try again")
    return JSONResponse({key: value for key, value in state.items() if key != "expires"}, headers={"Cache-Control": "no-store"})

@app.post("/convert")
async def convert_video(file: UploadFile = File(...), fps: int = Form(10), width: int = Form(320)):
    if not 1 <= fps <= 30 or not 100 <= width <= 800:
        raise HTTPException(422, "Use 1–30 FPS and a width of 100–800 pixels")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".mp4", ".avi", ".mov", ".webm", ".mkv", ".m4v"}:
        raise HTTPException(400, "Choose an MP4, MOV, WebM, AVI, MKV or M4V video")
    job = uuid.uuid4().hex
    source = UPLOAD_DIR / (job + extension)
    filename = f"output_{job}.gif"
    destination = OUTPUT_DIR / filename
    try:
        total = 0
        with source.open("xb") as stream:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, "Maximum upload size is 100 MiB")
                stream.write(chunk)
        if not total:
            raise HTTPException(400, "The video is empty")
        async with conversion_slots:
            # ctypes releases the GIL; the worker also keeps the event loop responsive.
            size = await run_in_threadpool(core.convert, str(source), str(destination), fps, width)
        return {"filename": filename, "file_size": f"{size / 1024:.1f} KB", "fps": fps, "width": width}
    except core.ConversionError as error:
        status = 422 if isinstance(error, (core.InvalidInput, core.InvalidOptions, core.EncodingFailed)) else 503
        raise HTTPException(status, str(error)) from error
    finally:
        source.unlink(missing_ok=True)
        await file.close()

@app.get("/download/{filename}")
async def download(filename: str):
    if not re.fullmatch(r"output_[a-f0-9]{32}\.gif", filename):
        raise HTTPException(400, "Invalid filename")
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "GIF not found")
    return FileResponse(path, media_type="image/gif", filename=filename)

# A built web directory can be served locally by the same service or by Netlify.
app.mount("/", StaticFiles(directory=BASE_DIR / "web", html=True), name="studio")
