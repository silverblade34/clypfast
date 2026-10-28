"""Offline music regression tests, including real FFmpeg stereo/subtitle export."""
import json
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clipfinder.music import (
    LyricLine, SubtitleStyle, analyze_music, clipped_lines, make_ass, make_srt, translate_lyrics,
)
from clipfinder import music_api


class MusicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.override = patch.object(music_api, "ROOT", self.root)
        self.override.start()
        self.app = FastAPI()
        self.app.include_router(music_api.router)
        self.client = TestClient(self.app)
        self.id = "a" * 32
        folder = self.root / self.id
        folder.mkdir()
        self.folder = folder
        (folder / "project.json").write_text(json.dumps({
            "id": self.id, "status": "done", "progress": 100, "duration": 10,
            "title": "Test", "media_ready": True, "lyrics": [],
            "request": music_api.MusicRequest(url="https://youtu.be/test").model_dump(),
        }))

    def tearDown(self):
        self.override.stop()
        self.temp.cleanup()

    def audio(self, samples, name="audio.wav"):
        path = self.root / name
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes((samples * 32767).astype("<i2").tobytes())
        return path

    def test_silence_and_steady_tone_do_not_invent_peaks(self):
        for samples in [np.zeros(16000 * 10), .2 * np.sin(2 * np.pi * 440 * np.arange(16000 * 10) / 16000)]:
            result = analyze_music(self.audio(samples), 5)
            self.assertEqual(result["moments"], [])
            self.assertLessEqual(len(result["timeline"]), 600)

    def test_energy_transition_produces_bounded_nonduplicate_candidates(self):
        t = np.arange(16000 * 30) / 16000
        samples = .02 * np.sin(2 * np.pi * 220 * t)
        samples[(t >= 12) & (t < 18)] *= 15
        result = analyze_music(self.audio(samples), 10)
        self.assertTrue(result["moments"])
        self.assertTrue(any(11 <= m["peak"] <= 19 for m in result["moments"]))
        for m in result["moments"]:
            self.assertGreaterEqual(m["start"], 0)
            self.assertLessEqual(m["end"], 30)
        self.assertLessEqual(len(result["timeline"]), 600)

    def test_trim_clamps_and_offsets_subtitles(self):
        lines = [LyricLine(id=0, start=1, end=4, original="Hello", spanish="Hola"),
                 LyricLine(id=1, start=5, end=8, original="World", spanish="Mundo")]
        result = clipped_lines(lines, 3, 6)
        self.assertEqual([(l.start, l.end) for l in result], [(0, 1), (2, 3)])
        self.assertIn("00:00:00,000 --> 00:00:01,000\nHOLA", make_srt(result, "spanish"))
        self.assertEqual(lines[0].start, 1)

    def test_missing_translation_and_ass_control_escaping(self):
        line = LyricLine(id=0, start=0, end=2, original=r"{\pos(0,0)}Hello")
        with self.assertRaises(ValueError):
            make_ass([line], SubtitleStyle())
        ass = make_ass([line], SubtitleStyle(mode="original"))
        self.assertNotIn(r"{\pos(0,0)}", ass)
        self.assertIn("｛", ass)

    def test_translation_rejects_duplicate_ids_and_preserves_times(self):
        line = LyricLine(id=3, start=1.25, end=3.75, original="Hello")
        result = MagicMock()
        result.choices[0].message.content = '{"lines":[{"id":3,"text":"Hola"}]}'
        with patch.dict("os.environ", {"GROQ_API_KEY": "test"}), patch("groq.Groq") as groq:
            groq.return_value.chat.completions.create.return_value = result
            translated = translate_lyrics([line])
            self.assertEqual((translated[0].start, translated[0].end), (1.25, 3.75))
            self.assertEqual(translated[0].spanish, "Hola")
            result.choices[0].message.content = '{"lines":[{"id":3,"text":"Hola"},{"id":3,"text":"Hola"}]}'
            with self.assertRaises(ValueError):
                translate_lyrics([line])

    def test_rejects_non_youtube_and_path_escape(self):
        for url in ["https://youtube.com.evil.test/watch?v=x", "file:///tmp/file", "https://example.com/video"]:
            self.assertEqual(self.client.post("/music/projects", json={"url": url}).status_code, 422)
        self.assertEqual(self.client.get("/music/projects/not-a-project").status_code, 404)
        self.assertEqual(self.client.get(f"/music/projects/{self.id}/files/project.json").status_code, 404)

    def test_lyrics_persist_and_invalid_ranges_fail(self):
        body = {"lyrics": [{"id": 0, "start": 1, "end": 3, "original": "Hello", "spanish": "Hola"}]}
        path = f"/music/projects/{self.id}/lyrics"
        self.assertEqual(self.client.patch(path, json=body).status_code, 200)
        self.assertEqual(music_api.read_project(self.id)["lyrics"][0]["spanish"], "Hola")
        body["lyrics"][0]["end"] = 11
        self.assertEqual(self.client.patch(path, json=body).status_code, 422)
        body["lyrics"][0]["end"] = 0
        self.assertEqual(self.client.patch(path, json=body).status_code, 422)

    def test_export_rejects_missing_translation_and_out_of_bounds(self):
        path = f"/music/projects/{self.id}/exports"
        body = {"start": 0, "end": 5, "lyrics": [{"id": 0, "start": 1, "end": 3, "original": "Hello"}]}
        self.assertEqual(self.client.post(path, json=body).status_code, 422)
        body.update(end=20, style={"mode": "original"})
        self.assertEqual(self.client.post(path, json=body).status_code, 422)
        body.update(end=float("nan"))
        with self.assertRaises(ValueError):
            self.client.post(path, json=body)

    def test_translation_failure_keeps_music_and_original_lyrics(self):
        music_api.update(self.id, lyrics=[{"id": 0, "start": 0, "end": 2, "original": "Hello"}],
                         duration=60, moments=[{"start": 0, "end": 5}])
        music_api.ACTIVE.add(self.id)
        try:
            with self.assertLogs("clipfinder.music_api", level="ERROR"), patch.object(
                music_api, "translate_lyrics", side_effect=ValueError("Proveedor no disponible")
            ):
                music_api.translate_project(self.id, "groq")
            data = music_api.read_project(self.id)
            self.assertEqual(data["status"], "done")
            self.assertEqual(data["lyrics"][0]["original"], "Hello")
            self.assertTrue(data["moments"])
            self.assertIn("Proveedor", data["translation_error"])
        finally:
            music_api.ACTIVE.discard(self.id)

    def test_retry_browser_session_is_explicit_and_not_persisted(self):
        music_api.update(self.id, status="error", error="YouTube bloqueó la descarga")
        with patch.object(music_api, "launch") as launch:
            response = self.client.post(f"/music/projects/{self.id}/retry", json={"youtube_browser": "brave"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(launch.call_args.args[2].youtube_browser, "brave")
        saved = json.loads((self.folder / "project.json").read_text())
        self.assertIsNone(saved["request"].get("youtube_browser"))
        music_api.update(self.id, status="error")
        with patch.object(music_api, "launch") as launch:
            self.assertEqual(self.client.post(f"/music/projects/{self.id}/retry", json={}).status_code, 200)
            self.assertIsNone(launch.call_args.args[2].youtube_browser)

    def test_local_music_uses_saved_audio_and_reports_progress_without_youtube(self):
        music_api.update(self.id, moments=[])
        request = music_api.MusicRequest(url="https://youtu.be/test", language="en", engine="local", subtitle_mode="original")
        seen = []
        def recognize(path, **kwargs):
            self.assertEqual(path, self.folder / "audio.wav")
            kwargs["stage_callback"]("Cargando modelo local")
            kwargs["progress_callback"](50, 12)
            snapshot = music_api.read_project(self.id)
            seen.append(snapshot)
            return [], 10
        music_api.ACTIVE.add(self.id)
        try:
            with patch("clipfinder.subtitles.fetch_youtube_subtitles") as captions, patch(
                "clipfinder.transcriber.transcribe", side_effect=recognize
            ):
                music_api.transcribe_project(self.id, request)
            captions.assert_not_called()
            self.assertEqual(seen[0]["transcription_percent"], 50)
            self.assertEqual(seen[0]["transcription_segments"], 12)
            self.assertGreater(seen[0]["progress"], 65)
            self.assertEqual(music_api.read_project(self.id)["status"], "done")
        finally:
            music_api.ACTIVE.discard(self.id)

    def test_restart_reports_interrupted_work(self):
        music_api.update(self.id, status="processing")
        self.assertEqual(music_api.read_project(self.id)["status"], "error")

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_pipeline_download_analysis_and_transcription_recovery(self):
        source = self.folder / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=4",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ac", "2", "-c:v", "libx264",
                        "-c:a", "aac", "-shortest", str(source)], check=True, capture_output=True)
        downloader = MagicMock()
        downloader.extract_info.return_value = {"title": "Offline song", "duration": 4}
        req = music_api.MusicRequest(url="https://youtu.be/test", language="auto", engine="local")
        music_api.ACTIVE.add(self.id)
        try:
            with patch("yt_dlp.YoutubeDL") as factory, patch(
                "clipfinder.transcriber.transcribe", side_effect=RuntimeError("Transcripción no disponible")
            ) as transcriber:
                factory.return_value.__enter__.return_value = downloader
                with self.assertLogs("clipfinder.music_api", level="ERROR"):
                    music_api.analyze_project(self.id, req)
                self.assertIsNone(transcriber.call_args.kwargs["language"])
            data = music_api.read_project(self.id)
            self.assertEqual(data["status"], "done")
            self.assertTrue(data["media_ready"])
            self.assertTrue(data["timeline"])
            self.assertEqual(data["lyrics_error"], "Transcripción no disponible")
            self.assertTrue((self.folder / "preview.mp4").exists())
        finally:
            music_api.ACTIVE.discard(self.id)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_real_export_has_stereo_audio_correct_duration_and_subtitles(self):
        source = self.folder / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=4",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ac", "2", "-c:v", "libx264",
                        "-c:a", "aac", "-shortest", str(source)], check=True, capture_output=True)
        music_api.update(self.id, source_file="source.mp4", duration=4)
        body = music_api.ExportRequest(start=1, end=3, lyrics=[
            LyricLine(id=0, start=.5, end=2, original="Hello", spanish="Hola")])
        export_id = "b" * 32
        music_api.render_project(self.id, body, export_id)
        self.assertEqual(music_api.read_project(self.id)["export"]["status"], "done")
        output = self.folder / f"{export_id}.mp4"
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
                               check=True, capture_output=True, text=True)
        info = json.loads(probe.stdout)
        self.assertAlmostEqual(float(info["format"]["duration"]), 2, delta=.15)
        self.assertEqual(next(s for s in info["streams"] if s["codec_type"] == "audio")["channels"], 2)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        self.assertEqual((video["width"], video["height"]), (1080, 1920))
        self.assertIn("00:00:00,000 --> 00:00:01,000\nHOLA", (self.folder / f"{export_id}.spanish.srt").read_text())
        response = self.client.get(f"/music/projects/{self.id}/files/{export_id}.mp4", headers={"Range": "bytes=0-99"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(len(response.content), 100)


if __name__ == "__main__":
    unittest.main()
