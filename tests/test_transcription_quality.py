import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from clipfinder.groq_whisper import _compress_audio, _transcribe_file
from clipfinder.subtitles import fetch_youtube_subtitles, _pick_subtitle_track


class TranscriptionQualityTests(unittest.TestCase):
    def test_auto_mode_rejects_automatic_captions(self):
        ydl = MagicMock()
        ydl.extract_info.return_value = {
            "duration": 30, "subtitles": {},
            "automatic_captions": {"es": [{"url": "https://example.com", "ext": "json3"}]},
        }
        with patch("yt_dlp.YoutubeDL") as factory, patch("clipfinder.subtitles._parse_subtitle_entries") as parse:
            factory.return_value.__enter__.return_value = ydl
            self.assertIsNone(fetch_youtube_subtitles("https://youtube.com/watch?v=x", allow_automatic=False))
            parse.assert_not_called()

    def test_preserves_words_and_offsets(self):
        client = MagicMock()
        client.audio.transcriptions.create.return_value = SimpleNamespace(
            segments=[{"text": "mi padre", "start": 1, "end": 3}],
            words=[{"word": "mi", "start": 1.1, "end": 1.3}, {"word": "padre", "start": 1.4, "end": 2}],
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.flac"
            path.write_bytes(b"audio")
            segments = _transcribe_file(client, path, "whisper-large-v3", "es", 600)
        self.assertEqual(segments[0].words[0]["start"], 601.1)
        self.assertEqual(segments[0].start, 601)
        self.assertEqual(client.audio.transcriptions.create.call_args.kwargs["timestamp_granularities"], ["segment", "word"])

    def test_preprocessing_is_lossless(self):
        with patch("clipfinder.groq_whisper.subprocess.run") as run:
            _compress_audio(Path("audio.wav"), Path("output.flac"))
        command = run.call_args.args[0]
        self.assertIn("flac", command)
        self.assertNotIn("32k", command)

    def test_language_prefix_does_not_match_unrelated_language(self):
        self.assertEqual(_pick_subtitle_track({"en": [1], "estonian": [2]}, ["es"]), (None, None))
