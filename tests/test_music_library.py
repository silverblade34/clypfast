import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from clipfinder import music_api, music_library
from clipfinder.music import LyricLine, SubtitleStyle, caption_cues, make_ass


class MusicLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.override = patch.object(music_library, "LIBRARY", self.root / "library")
        self.override.start()
        self.app = FastAPI()
        self.app.include_router(music_api.router)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.override.stop()
        self.temp.cleanup()

    def test_builtins_provide_themes_images_and_animated_gif(self):
        result = self.client.get("/music/library")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), [])  # Only uploaded files are offered in the editor.
        assets = music_library.list_assets()  # Legacy backgrounds remain readable.
        self.assertEqual(len(assets), 7)
        self.assertEqual(len({item["theme"] for item in assets}), 6)
        gif = next(item for item in assets if item["kind"] == "gif")
        response = self.client.get(f"/music/library/{gif['id']}/file")
        with Image.open(io.BytesIO(response.content)) as image:
            self.assertGreater(image.n_frames, 1)

    def test_upload_is_validated_persistent_and_reusable(self):
        output = io.BytesIO()
        Image.new("RGB", (100, 180), "blue").save(output, "PNG")
        response = self.client.post("/music/library?title=Mi%20recuerdo&theme=nostalgia",
                                    content=output.getvalue(), headers={"Content-Type": "application/octet-stream"})
        self.assertEqual(response.status_code, 200)
        asset = response.json()
        self.assertEqual(asset["title"], "Mi recuerdo")
        self.assertIn(asset["id"], [a["id"] for a in music_library.list_assets()])
        self.assertEqual(self.client.get(f"/music/library/{asset['id']}/file").status_code, 200)
        self.assertEqual(self.client.post("/music/library", content=b"not an image").status_code, 422)
        self.assertEqual(self.client.get("/music/library/project.json/file").status_code, 404)

    def test_centered_uppercase_overrides_old_saved_preferences(self):
        style = SubtitleStyle(casing="natural", margin=65)
        line = LyricLine(id=0, start=0, end=2, original="hola mundo", spanish="escucha tu corazón")
        self.assertEqual(caption_cues([line], style)[0]["text"], "ESCUCHA TU CORAZÓN")
        ass = make_ass([line], style)
        self.assertIn(",1,3,2,5,85,85,0,1", ass)  # ASS alignment 5 = center.
        self.assertEqual(style.casing, "uppercase")

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_image_and_gif_render_with_original_stereo_audio(self):
        project_id = "c"*32
        project = self.root / project_id
        project.mkdir()
        source = project / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=3",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "2", "-c:v", "libx264",
                        "-c:a", "aac", "-shortest", str(source)], check=True, capture_output=True)
        (project / "project.json").write_text(json.dumps({"id": project_id, "status": "done", "source_file": "source.mp4"}))
        with patch.object(music_api, "ROOT", self.root):
            for index, background in enumerate(["scene-soledad", "scene-rain"]):
                export_id = str(index)*32
                body = music_api.ExportRequest(start=.5, end=2.5, style=SubtitleStyle(background_id=background),
                    lyrics=[LyricLine(id=0, start=0, end=3, original="Hello", spanish="Mi canción")])
                music_api.render_project(project_id, body, export_id)
                self.assertEqual(music_api.read_project(project_id)["export"]["status"], "done")
                probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(project/f"{export_id}.mp4")], check=True, capture_output=True, text=True)
                result = json.loads(probe.stdout)
                video = next(s for s in result["streams"] if s["codec_type"] == "video")
                audio = next(s for s in result["streams"] if s["codec_type"] == "audio")
                self.assertEqual((video["width"], video["height"]), (1080, 1920))
                self.assertEqual(audio["channels"], 2)
                self.assertAlmostEqual(float(result["format"]["duration"]), 2, delta=.2)
