import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from clipfinder.music import LyricLine, LyricWord, SubtitleStyle, caption_cues
from clipfinder.music_review import phrase_lines, review_lyrics


class ReviewTests(unittest.TestCase):
    def test_group_phrases_before_translation_preserves_boundaries_and_words(self):
        rows = [LyricLine(id=i, start=i, end=i+.9, original=t,
                         words=[LyricWord(word=t, start=i, end=i+.9)])
                for i,t in enumerate(['I know I handle', 'some things immaturely.', 'I need to grow.'])]
        grouped = phrase_lines(rows)
        self.assertEqual(len(grouped), 2)
        self.assertEqual(grouped[0].original, 'I know I handle some things immaturely.')
        self.assertEqual((grouped[0].start, grouped[0].end), (0, 1.9))
        self.assertEqual(len(grouped[0].words), 2)

    def test_only_confident_unique_ids_accepted_and_timings_not_changed(self):
        lines=[LyricLine(id=i,start=i*10,end=i*10+8,original='I handle things immaterally',
                         words=[LyricWord(word='I',start=i*10,end=i*10+1)]) for i in range(3)]
        with patch('clipfinder.music_review.music_json',return_value={'lines':[
            {'id':0,'text':'I handle things immaturely','confidence':.99,'uncertain':False},
            {'id':1,'text':'I handle things differently','confidence':.7,'uncertain':True},
            {'id':2,'text':'new text','confidence':.99,'uncertain':False},
            {'id':2,'text':'duplicate','confidence':.99,'uncertain':False}]}):
            result, changes, doubts=review_lyrics(lines,'groq')
        self.assertEqual(result[0].original,'I handle things immaturely')
        self.assertEqual(result[0].words,[])
        self.assertEqual(result[1:],lines[1:])
        self.assertEqual(len(changes),1)
        self.assertEqual(len(doubts),2)
        self.assertEqual((result[0].start,result[0].end),(0,8))
        self.assertEqual(changes[0]['evidence'],'context')

    def test_gemini_receives_real_audio_excerpt(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'audio.wav'
            with wave.open(str(path),'wb') as out:
                out.setparams((1,2,16000,0,'NONE','not compressed'))
                out.writeframes(b'\0\0'*16000*3)
            with patch('clipfinder.music_review.music_json',return_value={'lines':[
                {'id':0,'text':'Therapy session','confidence':.98,'uncertain':False}]}) as model:
                result,changes,doubts=review_lyrics([LyricLine(id=0,start=1,end=2,original='There will be')], 'gemini', audio_path=path)
            self.assertTrue(model.call_args.kwargs['audio'].startswith(b'RIFF'))
            self.assertEqual(changes[0]['evidence'],'audio')
            self.assertEqual(doubts,[])
            cues=caption_cues([result[0].model_copy(update={'spanish':'Una sesión de terapia para mí'})],SubtitleStyle(max_words=3))
            self.assertTrue(all(len(cue['text'].split())<=3 for cue in cues))
            self.assertEqual(cues[0]['start'],1)
            self.assertEqual(cues[-1]['end'],2)

    def test_array_response_is_accepted_and_missing_sections_are_flagged(self):
        lines=[LyricLine(id=0,start=0,end=3,original="First phrase"),
               LyricLine(id=1,start=15,end=18,original="Second phrase")]
        with patch('clipfinder.music_review.music_json',return_value=[
            {'id':i,'text':row.original,'confidence':.99,'uncertain':False} for i,row in enumerate(lines)]):
            result,changes,doubts=review_lyrics(lines,'groq')
        self.assertEqual(result,lines)
        self.assertEqual(changes,[])
        self.assertEqual((doubts[0]['start'],doubts[0]['end']),(3,15))

    def test_project_revision_retains_snapshot_and_translates_reviewed_phrases(self):
        import json
        from clipfinder import music_api
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            project_id='e'*32
            directory=root/project_id
            directory.mkdir()
            raw=[dict(id=0,start=0,end=4,original="I handle things immaterally",spanish="inmaterial")]
            (directory/'project.json').write_text(json.dumps(dict(id=project_id,status='done',duration=40,
                title='Song',request={'provider':'groq','subtitle_mode':'spanish'},lyrics=raw,
                moments=[],acoustic_moments=[])))
            music_api.ACTIVE.add(project_id)
            try:
                with patch.object(music_api,'ROOT',root), patch('clipfinder.music_review.music_json',return_value={
                    'lines':[{'id':0,'text':'I handle things immaturely','confidence':.99,'uncertain':False}]}), patch.object(
                    music_api,'translate_project') as translate, patch.object(music_api,'refresh_highlights'):
                    music_api.improve_lyrics(project_id,'groq')
                    saved=music_api.read_project(project_id)
                    translate.assert_called_once_with(project_id,'groq')
                    self.assertEqual(saved['raw_transcription'],raw)
                    self.assertEqual(saved['review_backup'],raw)
                    self.assertEqual(saved['lyrics'][0]['original'],'I handle things immaturely')
                    self.assertEqual(saved['lyrics'][0]['spanish'],'')
                    self.assertEqual(saved['review_version'],1)
                    self.assertEqual(saved['status'],'done')
            finally:
                music_api.ACTIVE.discard(project_id)

    def test_unrelated_duplicate_translations_are_retried(self):
        from clipfinder.music import translate_lyrics
        lines=[LyricLine(id=0,start=0,end=5,original="The lights illuminate the crowded streets"),
               LyricLine(id=1,start=5,end=10,original="My heart was broken when you left me")]
        duplicate="Esta misma traducción larga no debe aparecer en ambas frases distintas"
        with patch('clipfinder.music.music_json',side_effect=[
            {'lines':[{'id':0,'text':duplicate},{'id':1,'text':duplicate}]},
            {'lines':[{'id':0,'text':'Las luces iluminan las calles llenas de gente'},
                      {'id':1,'text':'Se me rompió el corazón cuando te fuiste'}]}]) as model:
            result=translate_lyrics(lines)
        self.assertEqual(model.call_count,2)
        self.assertNotEqual(result[0].spanish,result[1].spanish)
