"""Browser GIF encoder and the static precache writer. No conversion server."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def load_build_web():
    spec = importlib.util.spec_from_file_location("build_web", ROOT / "scripts" / "build_web.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GifEncoderTests(unittest.TestCase):
    def test_roundtrip_palette_loop_and_transparency(self):
        with tempfile.TemporaryDirectory() as temp:
            solid, trans, noise = Path(temp) / "solid.gif", Path(temp) / "trans.gif", Path(temp) / "noise.gif"
            subprocess.check_call(["node", str(ROOT / "tests" / "gif-roundtrip.mjs"), solid, trans, noise], cwd=ROOT)
            with Image.open(solid) as image:
                self.assertEqual(image.format, "GIF")
                self.assertEqual(image.size, (8, 8))
                self.assertEqual(image.n_frames, 2)
                self.assertEqual(image.info.get("loop"), 0)
                image.seek(0)
                self.assertEqual(image.convert("RGB").getpixel((1, 1)), (255, 0, 0))
                self.assertEqual(image.info.get("duration"), 100)
                image.seek(1)
                self.assertEqual(image.convert("RGB").getpixel((1, 1)), (0, 0, 255))
            with Image.open(trans) as image:
                rgba = image.convert("RGBA")
                self.assertEqual(rgba.getpixel((0, 0)), (255, 0, 0, 255))
                self.assertEqual(rgba.getpixel((3, 0))[3], 0)
            with Image.open(noise) as noisy:
                self.assertEqual(noisy.size, (96, 96))
                self.assertEqual(noisy.n_frames, 1)
                self.assertEqual(len(noisy.convert("RGB").getpixel((10, 10))), 3)

    def test_precache_is_relative_and_versioned(self):
        build_web = load_build_web()
        with tempfile.TemporaryDirectory() as temp:
            dist = Path(temp)
            (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
            (dist / "studio.js").write_text("export {}", encoding="utf-8")
            (dist / "wasm").mkdir()
            (dist / "wasm" / "gifmaker_studio.js").write_text("export {}", encoding="utf-8")
            (dist / "wasm" / "gifmaker_studio_bg.wasm").write_bytes(b"\0asm")
            (dist / "fonts").mkdir()
            (dist / "fonts" / "IBMPlexSans-Regular.ttf").write_bytes(b"font")
            (dist / "sw.js").write_text(
                'const CACHE = "gifmaker-live-dev";\nconst PRECACHE = [\n  "./",\n  "./index.html",\n];\n',
                encoding="utf-8",
            )
            version = build_web.write_precache(dist)
            text = (dist / "sw.js").read_text(encoding="utf-8")
            self.assertIn(f'const CACHE = "{version}";', text)
            self.assertIn('"./"', text)
            self.assertIn('"./wasm/gifmaker_studio_bg.wasm"', text)
            self.assertIn('"./fonts/IBMPlexSans-Regular.ttf"', text)
            block = text.split("const PRECACHE = ", 1)[1].split("];", 1)[0]
            self.assertNotIn('"/', block)
            (dist / "studio.js").write_text("export const changed = true", encoding="utf-8")
            (dist / "sw.js").write_text(
                'const CACHE = "gifmaker-live-dev";\nconst PRECACHE = [\n  "./",\n  "./index.html",\n];\n',
                encoding="utf-8",
            )
            self.assertNotEqual(build_web.write_precache(dist), version)


if __name__ == "__main__":
    unittest.main()
