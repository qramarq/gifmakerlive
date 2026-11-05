"""Camera connectivity unit tests. They run the browser-free module checks."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CameraModuleTests(unittest.TestCase):
    def test_node_camera_unit_tests(self):
        subprocess.check_call(["node", "--test", "tests/camera.test.mjs"], cwd=ROOT)


if __name__ == "__main__":
    unittest.main()
