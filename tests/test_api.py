"""Integration tests deliberately call the generated binding and real FFmpeg."""
import importlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from fastapi.testclient import TestClient

class ConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        os.environ["GIFMAKER_UPLOAD_DIR"] = str(cls.root / "uploads")
        os.environ["GIFMAKER_OUTPUT_DIR"] = str(cls.root / "output")
        cls.app_module = importlib.import_module("app")
        cls.client = TestClient(cls.app_module.app)
        cls.source = cls.root / "sample.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "0.5", "-pix_fmt", "yuv420p", str(cls.source)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.temp.cleanup()

    def test_rust_binding_conversion_download_and_cleanup(self):
        with self.source.open("rb") as source:
            response = self.client.post("/convert", files={"file": ("sample.mp4", source, "video/mp4")}, data={"fps":15,"width":480})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        gif = self.client.get("/download/" + result["filename"])
        self.assertEqual(gif.status_code, 200)
        self.assertEqual(gif.headers["content-type"], "image/gif")
        self.assertEqual(int.from_bytes(gif.content[6:8], "little"), 480)
        self.assertEqual(int.from_bytes(gif.content[8:10], "little"), 270)
        self.assertIn(b"NETSCAPE2.0", gif.content)  # Looping animation extension.
        self.assertFalse(list((self.root / "uploads").iterdir()))

    def test_bad_input_and_options(self):
        for data, file, expected in [({"fps":0},("x.mp4",b"data"),422), ({},("x.txt",b"data"),400), ({},("x.mp4",b""),400), ({},("x.mp4",b"invalid video"),422)]:
            response = self.client.post("/convert", data=data, files={"file":file})
            self.assertEqual(response.status_code, expected, response.text)
        self.assertFalse(list((self.root / "uploads").iterdir()))

    def test_size_limit_and_filename_validation(self):
        original = self.app_module.MAX_BYTES
        try:
            self.app_module.MAX_BYTES = 3
            response = self.client.post("/convert", files={"file":("x.mp4",b"four")})
            self.assertEqual(response.status_code, 413)
        finally:
            self.app_module.MAX_BYTES = original
        self.assertEqual(self.client.get("/download/not-a-gif").status_code, 400)
        self.assertEqual(self.client.get("/download/output_" + "a" * 32 + ".gif").status_code, 404)
        self.assertEqual(self.client.get("/health").json()["engine"], "rust-weaveffi")

if __name__ == "__main__":
    unittest.main()
