"""Validate and prepare a bounded video edit before Rust GIF encoding."""
import json
import math
import subprocess
import tempfile
from pathlib import Path

import gifmaker_core as core


class EditError(ValueError):
    pass


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise EditError("Edit coordinates and times must be finite numbers")
    return value


def parse_edits(raw):
    try:
        if len(raw) > 4096:
            raise EditError("Video edits are too large")
        edits = json.loads(raw)
        segments = edits["segments"]
        crop = edits.get("crop", [0, 0, 100, 100])
        if not isinstance(segments, list) or not 1 <= len(segments) <= 10:
            raise EditError("Choose between one and ten segments")
        total = 0
        for segment in segments:
            start, end = map(number, segment)
            if start < 0 or end <= start:
                raise EditError("Each segment must end after it starts")
            total += end - start
        if total > 5 + 1e-9:
            raise EditError("Selected segments must total no more than 5 seconds")
        x, y, w, h = map(number, crop)
        if min(x, y) < 0 or min(w, h) < 1 or x + w > 100 or y + h > 100:
            raise EditError("Crop must fit inside the video and be at least 1% wide and high")
        return segments, (x, y, w, h)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        if isinstance(error, EditError):
            raise
        raise EditError("Invalid video edits") from error


def run(command):
    try:
        return subprocess.run(command, check=True, capture_output=True, timeout=60).stdout
    except subprocess.TimeoutExpired as error:
        raise EditError("Video preparation timed out. Try a smaller source video") from error
    except subprocess.CalledProcessError as error:
        raise EditError("Unable to decode this video or apply its edits") from error


def convert(source, destination, fps, width, raw):
    # Parse before invoking any external process. Only validated numbers enter filters.
    segments, crop = parse_edits(raw) if raw else (None, (0, 0, 100, 100))
    probe = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                           "-show_entries", "stream=width,height,duration:format=duration",
                           "-of", "json", str(source)]))
    if not probe.get("streams"):
        raise EditError("Choose a file containing video")
    stream = probe["streams"][0]
    try:
        duration = float(stream.get("duration") or probe.get("format", {}).get("duration", 0))
    except (ValueError, TypeError):
        duration = 0
    # Some browser recordings omit duration. Explicit edits can still be decoded;
    # unedited recordings are bounded to the first five seconds by the filter.
    if segments is None:
        segments = [[0, min(duration, 5) if math.isfinite(duration) and duration > 0 else 5]]
    if duration > 0 and any(end > duration + .05 for _, end in segments):
        raise EditError("A selected segment extends past the end of the video")
    x, y, w, h = crop
    filters = []
    for index, (start, end) in enumerate(segments):
        filters.append(f"[0:v:0]trim=start={start}:end={end},setpts=PTS-STARTPTS[s{index}]")
    inputs = "".join(f"[s{i}]" for i in range(len(segments)))
    filters.append(f"{inputs}concat=n={len(segments)}:v=1:a=0,"
                   f"crop=iw*{w}/100:ih*{h}/100:iw*{x}/100:ih*{y}/100:exact=1,"
                   f"scale={width}:-1:flags=lanczos,setsar=1,fps={fps}[edited]")
    with tempfile.TemporaryDirectory(prefix="gif-edit-", dir=source.parent) as temporary:
        prepared = Path(temporary) / "edited.mkv"
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(source),
             "-filter_complex", ";".join(filters), "-map", "[edited]", "-an",
             "-t", "5", "-c:v", "ffv1", str(prepared)])
        return core.convert(str(prepared), str(destination), fps, width)
