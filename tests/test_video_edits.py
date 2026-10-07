"""Exercise the real edit -> Rust -> GIF path, including actual frame contents."""
import io
import json
import tempfile
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageSequence
import video_edits


class VideoEditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "colors.mp4"
        # Each second has a different left-hand color and a white right half.
        colors = ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan']
        for i, color in enumerate(colors):
            frame = Image.new('RGB', (160, 100), 'white')
            frame.paste(color, (0, 0, 80, 100))
            frame.save(cls.root / f'{i}.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-framerate', '1', '-i', str(cls.root / '%d.png'),
                        '-r', '10', '-pix_fmt', 'yuv420p', str(cls.source)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def request(self, edits=None, fps=10):
        import app
        uploads = self.root / 'uploads'; uploads.mkdir(exist_ok=True)
        outputs = self.root / 'outputs'; outputs.mkdir(exist_ok=True)
        with patch.object(app, 'UPLOAD_DIR', uploads), patch.object(app, 'OUTPUT_DIR', outputs), TestClient(app.app) as client:
            data = {'fps': fps, 'width': 100}
            if edits is not None:
                data['edits'] = json.dumps(edits)
            response = client.post('/convert', files={'file': ('colors.mp4', self.source.read_bytes())}, data=data)
            self.assertEqual(list(uploads.iterdir()), [], 'All source and intermediate files must be removed')
            if response.status_code != 200:
                return response, None
            result = client.get('/download/' + response.json()['filename'])
            return response, Image.open(io.BytesIO(result.content))

    def test_splice_order_crop_and_duration(self):
        response, gif = self.request({'segments': [[2, 3], [0, 1]], 'crop': [0, 0, 50, 100]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(gif.size, (100, 125))
        frames = [frame.convert('RGB') for frame in ImageSequence.Iterator(gif)]
        self.assertGreater(frames[0].getpixel((50, 60))[2], 200)  # Blue segment first.
        self.assertGreater(frames[-1].getpixel((50, 60))[0], 200)  # Red segment last.
        self.assertLess(frames[0].getpixel((95, 60))[0], 30)  # White half cropped away.
        self.assertEqual(sum(frame.info['duration'] for frame in ImageSequence.Iterator(gif)), 2000)
        self.assertEqual(gif.info['loop'], 0)

    def test_five_second_selection_and_default_cap(self):
        for edits in [None, {'segments': [[1, 6]]}]:
            response, gif = self.request(edits)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(sum(frame.info['duration'] for frame in ImageSequence.Iterator(gif)), 5000)

    def test_five_second_timing_at_other_frame_rates(self):
        for fps in (1, 7, 15, 29, 30):
            with self.subTest(fps=fps):
                response, gif = self.request({'segments': [[0, 5]]}, fps=fps)
                self.assertEqual(response.status_code, 200, response.text)
                duration = sum(frame.info['duration'] for frame in ImageSequence.Iterator(gif))
                self.assertLessEqual(duration, 5010)  # GIF delays have centisecond precision.
                self.assertGreaterEqual(duration, 4990)

    def test_invalid_edits_rejected_and_cleaned(self):
        for edits in [
            {'segments': [[0, 5.01]]}, {'segments': [[0, 3], [1, 4]]},
            {'segments': [[-1, 1]]}, {'segments': [[2, 2]]}, {'segments': []},
            {'segments': [[5, 7]]}, {'segments': [[0, 1]], 'crop': [75, 0, 50, 100]},
            {'segments': [[0, 1]], 'crop': [0, 0, 0, 100]},
            {'segments': [[0, float('nan')]]}, {'segments': [[0, True]]},
            {'segments': 'bad'}, {'segments': [[0, 1, 2]]}, [],
        ]:
            with self.subTest(edits=edits):
                response, _ = self.request(edits)
                self.assertEqual(response.status_code, 422, response.text)

    def test_failed_preparation_removes_intermediate(self):
        with patch.object(video_edits, 'run', side_effect=[
            b'{"streams":[{"duration":"6"}]}', video_edits.EditError('decode failed')]):
            response, _ = self.request({'segments': [[0, 1]]})
        self.assertEqual(response.status_code, 422)


if __name__ == '__main__':
    unittest.main()
