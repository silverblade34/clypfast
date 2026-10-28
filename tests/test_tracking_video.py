import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2

from clipfinder.video_cropper import _open_tracking_video


class TrackingVideoTests(unittest.TestCase):
    def test_conversion_recovers_an_opencv_open_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "raw.mp4"
            subprocess.run([
                "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                "testsrc=size=160x90:rate=10", "-t", "1", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", str(video),
            ], check=True)
            original_capture = cv2.VideoCapture
            unavailable = MagicMock()
            unavailable.isOpened.return_value = False
            calls = 0

            def open_video(path):
                nonlocal calls
                calls += 1
                return unavailable if calls == 1 else original_capture(path)

            with patch("clipfinder.video_cropper.cv2.VideoCapture", side_effect=open_video):
                capture = _open_tracking_video(video)
                try:
                    self.assertTrue(capture.read()[0])
                finally:
                    capture.release()
            self.assertFalse(video.with_name("raw_compatible.mp4").exists())

    def test_corrupt_download_reports_clear_error_and_cleans_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "raw.mp4"
            video.write_bytes(b"invalid video" * 200)
            with self.assertRaisesRegex(ValueError, "incompleto"):
                _open_tracking_video(video)
            self.assertFalse(video.with_name("raw_compatible.mp4").exists())
