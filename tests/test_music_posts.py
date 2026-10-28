import unittest
from clipfinder.music import LyricLine, SubtitleStyle, make_ass, tiktok_description


class MusicPostTests(unittest.TestCase):
    def test_description_uses_only_the_selected_clip(self):
        lines = [LyricLine(id=0, start=1, end=3, original='Outside', spanish='Fuera del clip'),
                 LyricLine(id=1, start=25, end=30, original='Inside', spanish='Una canción que me entiende')]
        text = tiktok_description({'start': 20, 'end': 50}, lines, 'NF - Therapy Session')
        self.assertNotIn('“', text)
        self.assertNotIn('Yo opino', text)
        self.assertNotIn('Fuera del clip', text)
        self.assertIn('🎵 Therapy Session — NF', text)
        self.assertIn('#NF', text)
        self.assertIn('#TherapySession', text)
        self.assertIn('#Rap', text)
        self.assertIn('#Lunalgia', text)

    def test_instrumental_description_does_not_invent_lyrics(self):
        text = tiktok_description({'start': 0, 'end': 30, 'kind': 'energy'}, [], 'Instrumental')
        self.assertIn('Instrumental', text)
        self.assertNotIn('“', text)

    def test_branding_spans_full_trim_even_without_lyrics_or_subtitles(self):
        text = make_ass([], SubtitleStyle(mode='none'), 40, 70, song_title='Song {test}\\N')
        self.assertIn('Dialogue: 1,0:00:00.00,0:00:30.00,Account,,0,0,0,,Lunalgia', text)
        self.assertIn('Dialogue: 1,0:00:00.00,0:00:30.00,Song', text)
        self.assertIn('Song ｛test｝＼N', text)
        self.assertNotIn('Dialogue: 0', text)
        self.assertIn('Style: Account', text)
        self.assertIn('Style: Song', text)

    def test_loneliness_comment_is_short_and_uses_only_clip_context(self):
        lines = [LyricLine(id=0, start=1, end=5, original="love", spanish="amor"),
                 LyricLine(id=1, start=25, end=30, original="alone", spanish="siento que nadie me conoce")]
        text = tiktok_description({"start": 20, "end": 50}, lines, "Artist - Song (Official Video)", genre="Indie Pop")
        comment, credit, tags = text.split("\n\n")
        self.assertGreaterEqual(len(comment.split()), 25)
        self.assertLessEqual(len(comment.split()), 55)
        self.assertEqual(credit, "🎵 Song — Artist")
        self.assertIn("solo", comment)
        self.assertIn("#Soledad", tags)
        self.assertIn("#IndiePop", tags)
        self.assertNotIn("#Desamor", tags)
        self.assertNotIn("Official", tags)

    def test_unknown_genre_is_not_guessed_and_tags_have_no_punctuation(self):
        text = tiktok_description({"start": 0, "end": 30}, [], "Björk - Jóga", artist="Björk")
        self.assertIn("#Bjork", text)
        self.assertIn("#Joga", text)
        self.assertNotIn("#Rap", text)
