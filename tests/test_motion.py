"""Real HyperFrames -> PNG -> generated WeaveFFI -> FFmpeg regression tests."""
import importlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
import gifmaker_core as core
import image_motion


class MotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.app_module = importlib.import_module("app")
        cls.app_module.UPLOAD_DIR = cls.root / "uploads"
        cls.app_module.OUTPUT_DIR = cls.root / "output"
        cls.app_module.UPLOAD_DIR.mkdir()
        cls.app_module.OUTPUT_DIR.mkdir()
        cls.client = TestClient(cls.app_module.app)
        cls.source = cls.root / "still.png"
        cls.original = Image.new("RGBA", (96, 64), (28, 48, 72, 255))
        draw = ImageDraw.Draw(cls.original)
        draw.rectangle((4, 7, 31, 30), fill=(245, 73, 81, 255))
        draw.rectangle((55, 25, 90, 60), fill=(123, 220, 97, 255))
        cls.original.save(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.temp.cleanup()

    def upload(self, **data):
        with self.source.open("rb") as source:
            return self.client.post("/animate", files={"file": ("photo.png", source, "image/png")},
                                    data={"prompt": "gently float up and down", "duration": 2, **data})

    def test_original_pixels_survive_real_render_and_gif_encoding(self):
        response = self.upload()
        self.assertEqual(response.status_code, 202, response.text)
        result = self.client.get("/animate/" + response.json()["job_id"]).json()
        self.assertEqual(result["status"], "ready", result)
        content = self.client.get("/download/" + result["filename"]).content
        target = self.root / "result.gif"
        target.write_bytes(content)
        with Image.open(target) as gif:
            self.assertEqual(gif.size, (result["width"], result["height"]))
            self.assertEqual(gif.info["loop"], 0)
            self.assertGreater(gif.n_frames, 1)
            positions, elapsed = set(), 0
            for index in range(gif.n_frames):
                gif.seek(index)
                elapsed += gif.info["duration"]
                frame = gif.convert("RGBA")
                bounds = frame.getbbox()
                positions.add(bounds)
                restored = frame.crop(bounds)
                self.assertEqual(restored.size, self.original.size)
                self.assertEqual(restored.tobytes(), self.original.tobytes(), f"Source changed in GIF frame {index}")
            self.assertGreater(len(positions), 1, "The picture must actually move")
            self.assertAlmostEqual(elapsed, 2000, delta=100)
        self.assertFalse(list(self.app_module.UPLOAD_DIR.iterdir()))

    def test_motion_planner_rejects_injection_negation_and_subject_requests(self):
        for prompt in ["make the person wave", "don't pan left", "pan left and zoom in", "<script>pan left</script>", "pan left 100 pixels"]:
            response = self.upload(prompt=prompt)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse(list(self.app_module.UPLOAD_DIR.iterdir()))

    def test_bad_options_files_sizes_and_missing_jobs(self):
        self.assertEqual(self.upload(fps=31).status_code, 422)
        self.assertEqual(self.upload(duration=0).status_code, 422)
        self.assertEqual(self.upload(fps=1, duration=1).status_code, 422)
        self.assertEqual(self.upload(prompt=" ").status_code, 422)
        self.assertEqual(self.client.get("/animate/not-a-job").status_code, 404)
        with patch.object(self.app_module, "MAX_IMAGE_BYTES", 1):
            self.assertEqual(self.upload().status_code, 413)
        response = self.client.post("/animate", files={"file": ("bad.png", b"not an image")}, data={"prompt": "pan left"})
        status = self.client.get("/animate/" + response.json()["job_id"]).json()
        self.assertEqual(status["status"], "failed")
        self.assertFalse(list(self.app_module.UPLOAD_DIR.iterdir()))

    def test_resizing_requires_explicit_choice_and_budget_rejection(self):
        large = self.root / "large.png"
        Image.new("RGB", (2000, 1000)).save(large)
        with tempfile.TemporaryDirectory(dir=self.root) as path:
            project = Path(path)
            plan = json.loads(core.plan_motion("pan left"))
            with self.assertRaises(image_motion.MotionInputError):
                image_motion.prepare(large, project, plan, 10, 2, 320, True)
            image_motion.prepare(large, project, plan, 10, 2, 320, False)
            with Image.open(project / "source.png") as image:
                self.assertEqual(image.size, (320, 160))

    def test_failed_render_cleans_source_and_working_frames(self):
        with patch.object(image_motion, "run_renderer", side_effect=image_motion.MotionUnavailable("test render failed")):
            response = self.upload()
        result = self.client.get("/animate/" + response.json()["job_id"]).json()
        self.assertEqual(result["status"], "failed")
        self.assertFalse(list(self.app_module.UPLOAD_DIR.iterdir()))

    def test_rejects_animated_input_and_inconsistent_frame_sizes(self):
        animated = self.root / "animated.png"
        self.original.save(animated, save_all=True, append_images=[Image.new("RGBA", self.original.size)], duration=100)
        with tempfile.TemporaryDirectory(dir=self.root) as path:
            project = Path(path)
            with self.assertRaises(image_motion.MotionInputError):
                image_motion.prepare(animated, project, json.loads(core.plan_motion("float")), 10, 2, 320, True)
            for i in range(10):
                Image.new("RGBA", (96 + i, 64)).save(project / f"frame_{i:06}.png")
            with self.assertRaises(core.InvalidOptions):
                core.encode_motion(str(project), str(project / "bad.gif"), 10, 10)
            self.assertFalse((project / "bad.gif").exists())


if __name__ == "__main__":
    unittest.main()
