"""HTTP and browser adapter for the WeaveFFI Rust conversion core."""
import asyncio
import os
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
import gifmaker_core as core

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.environ.get("GIFMAKER_UPLOAD_DIR", BASE_DIR / "uploads"))
OUTPUT_DIR = Path(os.environ.get("GIFMAKER_OUTPUT_DIR", BASE_DIR / "output"))
for directory in (UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="GIF Maker Live", version="2.0.0")
conversion_slots = asyncio.Semaphore(2)
MAX_BYTES = 100 * 1024 * 1024

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "gif-maker-live", "engine": "rust-weaveffi"}

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
