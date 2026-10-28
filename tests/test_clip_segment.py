import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from clipfinder.video_cropper import download_clip_segment
from clipfinder.youtube_access import clean_download_error, youtube_options


class ClipSegmentTests(unittest.TestCase):
    def test_browser_cookies_are_opt_in_and_youtube_only(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertNotIn("cookiesfrombrowser", youtube_options("https://youtube.com/watch?v=x"))
        with patch.dict("os.environ", {"CLIPFINDER_YOUTUBE_COOKIES_BROWSER": "brave"}, clear=True):
            self.assertEqual(youtube_options("https://youtube.com/watch?v=x")["cookiesfrombrowser"], ("brave",))
            self.assertEqual(youtube_options("https://example.com"), {})

    def test_per_attempt_browser_override_is_opt_in_and_youtube_only(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertNotIn("cookiesfrombrowser", youtube_options("https://youtu.be/x"))
            self.assertEqual(youtube_options("https://youtu.be/x", "brave")["cookiesfrombrowser"], ("brave",))
            self.assertEqual(youtube_options("https://example.com/x", "brave"), {})
            self.assertNotIn("CLIPFINDER_YOUTUBE_COOKIES_BROWSER", __import__("os").environ)

    def test_login_block_does_not_retry_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            downloader = MagicMock()
            downloader.download.side_effect = RuntimeError("\x1b[0;31mERROR: Sign in to confirm you're not a bot")
            with patch("yt_dlp.YoutubeDL") as factory:
                factory.return_value.__enter__.return_value = downloader
                with self.assertRaisesRegex(RuntimeError, "YouTube bloqueó"):
                    download_clip_segment("https://youtube.com/watch?v=x", 10, 20, Path(directory) / "clip.mp4")
                downloader.extract_info.assert_not_called()

    def test_removes_terminal_colors(self):
        self.assertEqual(clean_download_error(RuntimeError("\x1b[0;31mERROR\x1b[0m")), "ERROR")

    def test_fallback_maps_separate_video_and_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "clip.mp4"
            downloader = MagicMock()
            downloader.download.side_effect = RuntimeError("range download failed")
            downloader.extract_info.return_value = {
                "requested_formats": [
                    {"url": "https://example.com/video", "vcodec": "h264", "acodec": "none"},
                    {"url": "https://example.com/audio", "vcodec": "none", "acodec": "aac"},
                ],
                "http_headers": {"User-Agent": "test-agent"},
            }

            def render(cmd, **kwargs):
                self.assertIn("0:v:0", cmd)
                self.assertIn("1:a:0?", cmd)
                self.assertEqual(cmd.count("-i"), 2)
                self.assertIn("User-Agent: test-agent\r\n", cmd)
                output.write_bytes(b"x" * 2000)

            with patch("yt_dlp.YoutubeDL") as factory, patch(
                "clipfinder.video_cropper.subprocess.run", side_effect=render
            ):
                factory.return_value.__enter__.return_value = downloader
                self.assertEqual(download_clip_segment("https://example.com", 10, 20, output), output)

    def test_provider_error_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            downloader = MagicMock()
            downloader.download.side_effect = RuntimeError("HTTP 403")
            downloader.extract_info.side_effect = RuntimeError("HTTP 403")
            with patch("yt_dlp.YoutubeDL") as factory:
                factory.return_value.__enter__.return_value = downloader
                with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                    download_clip_segment("https://example.com", 10, 20, Path(directory) / "clip.mp4")

    def test_invalid_interval(self):
        with self.assertRaises(ValueError):
            download_clip_segment("local.mp4", 20, 10, Path("unused.mp4"))
