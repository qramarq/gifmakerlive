"""Camera-format unit tests run in Node so they import the studio module directly."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CameraFormatTests(unittest.TestCase):
    def test_node_camera_format_suite(self):
        subprocess.check_call(["node", "--test", str(ROOT / "tests" / "camera-format.test.mjs")], cwd=ROOT)


if __name__ == "__main__":
    unittest.main()
