import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from clipfinder.video_cropper import download_clip_segment
from clipfinder.youtube_access import YoutubeSessionRequired


class RenderSessionTests(unittest.TestCase):
    def test_session_override_is_forwarded_and_not_saved(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            downloader=MagicMock()
            downloader.download.side_effect=RuntimeError("Sign in to confirm you're not a bot")
            with patch('yt_dlp.YoutubeDL') as factory:
                factory.return_value.__enter__.return_value=downloader
                with self.assertRaises(YoutubeSessionRequired):
                    download_clip_segment('https://youtu.be/test', 5, 15, Path(folder)/'clip.mp4', youtube_browser='brave')
                self.assertEqual(factory.call_args.args[0]['cookiesfrombrowser'], ('brave',))
                downloader.extract_info.assert_not_called()
            self.assertNotIn('CLIPFINDER_YOUTUBE_COOKIES_BROWSER', os.environ)

    def test_render_exposes_recoverable_session_error_and_reuses_original(self):
        import api
        render_id='session-test'
        with tempfile.TemporaryDirectory() as folder:
            api._render_jobs[render_id]={}
            try:
                with patch.object(api,'CLIPS_OUTPUT_DIR',Path(folder)), patch.object(
                        api,'_cached_render_source',return_value='/tmp/local-original.mp4'), patch(
                        'clipfinder.video_cropper.process_clip',side_effect=YoutubeSessionRequired('blocked')) as process:
                    api._run_render_job(render_id,api.RenderClipRequest(url='https://youtu.be/test',clip_index=0,
                        start_seconds=5,end_seconds=15,youtube_browser='brave'))
                job=api._get_render_job(render_id)
                self.assertEqual(job['status'],'error')
                self.assertEqual(job['error_code'],'youtube_session_required')
                self.assertEqual(process.call_args.kwargs['source'],'/tmp/local-original.mp4')
                self.assertEqual(process.call_args.kwargs['youtube_browser'],'brave')
                self.assertNotIn('CLIPFINDER_',job['error'])
            finally:
                api._render_jobs.pop(render_id,None)
