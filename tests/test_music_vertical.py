import unittest
from unittest.mock import patch

from clipfinder.models import TranscriptSegment
from clipfinder.music import (
    LyricLine, LyricWord, SubtitleStyle, caption_cues, clipped_lines, compact_segments,
    lyrical_moments, make_ass, make_srt, repetition_moments, video_filter, translate_lyrics,
)


class VerticalMusicTests(unittest.TestCase):
    def test_long_translations_advance_in_compact_nonoverlapping_cues(self):
        line = LyricLine(id=0, start=10, end=22,
                         original="Where is the person that I used to be before everything changed",
                         spanish="Dónde está la persona que yo solía ser antes de que todo cambiara")
        cues = caption_cues([line], SubtitleStyle(max_words=5))
        self.assertGreater(len(cues), 1)
        self.assertEqual(cues[0]["start"], 10)
        self.assertEqual(cues[-1]["end"], 22)
        self.assertTrue(all(len(cue["text"].split()) <= 5 for cue in cues))
        self.assertTrue(all(a["end"] <= b["start"] for a, b in zip(cues, cues[1:])))
        self.assertTrue(all(cue["timing"] == "estimated" for cue in cues))
        self.assertEqual(" ".join(cue["text"] for cue in cues), line.spanish.upper())

    def test_overlapping_youtube_segments_never_stack_on_screen(self):
        lines = [LyricLine(id=0, start=0, end=5, original="First phrase"),
                 LyricLine(id=1, start=3, end=6, original="Second phrase")]
        cues = caption_cues(lines, SubtitleStyle(mode="original"))
        self.assertEqual(cues[0]["end"], 3)

    def test_original_word_times_survive_clip_offset(self):
        line = LyricLine(id=0, start=10, end=14, original="One two three four",
                         words=[LyricWord(word=w, start=10+i, end=10+i+.4)
                                for i, w in enumerate(["One", "two", "three", "four"])])
        cues = caption_cues(clipped_lines([line], 9, 15), SubtitleStyle(mode="original", max_words=2))
        self.assertEqual([(c["start"], c["end"]) for c in cues], [(1, 2.4), (3, 4.4)])
        self.assertEqual(cues[0]["timing"], "words")

    def test_word_timed_transcription_splits_before_translation_and_preserves_gaps(self):
        segment = TranscriptSegment(start=0, end=12, text="one two three four five six seven eight",
                                    words=[{"word": str(i), "start": i, "end": i+.3} for i in range(8)])
        result = compact_segments([segment], 12)
        self.assertTrue(all(len(line.original.split()) <= 5 for line in result))
        self.assertTrue(all(line.words for line in result))
        self.assertLess(result[0].end, result[1].start)

    def test_music_markers_removed_and_shared_render_matches_preview(self):
        line = LyricLine(id=0, start=0, end=8, original="♪ One two three four five six ♪",
                         spanish="♪ Uno dos tres cuatro cinco seis ♪")
        style = SubtitleStyle(font="Georgia", max_words=3)
        cues = caption_cues([line], style)
        ass, srt = make_ass([line], style), make_srt([line], "spanish", style)
        self.assertNotIn("♪", ass)
        self.assertIn("PlayResX: 1080", ass)
        self.assertIn("PlayResY: 1920", ass)
        self.assertIn("Style: Default,Georgia", ass)
        for cue in cues:
            self.assertIn(cue["text"], ass)
            self.assertIn(cue["text"], srt)

    def test_refrain_requires_repetition_at_different_times(self):
        lines = [LyricLine(id=0, start=3, end=8, original="I will always find my way back home"),
                 LyricLine(id=1, start=40, end=45, original="I will always find my way back home")]
        result = repetition_moments(lines, 100, 15)
        self.assertTrue(result)
        self.assertEqual(result[0]["kind"], "chorus")
        self.assertFalse(repetition_moments(lines[:1], 100, 15))

    def test_ai_cannot_invent_timestamps_or_quotes(self):
        lines = [LyricLine(id=0, start=2, end=5, original="I remember", spanish="Lo recuerdo"),
                 LyricLine(id=1, start=5, end=10, original="who I am", spanish="quién soy")]
        with patch("clipfinder.music.music_json", return_value={"moments": [
            {"start_id": 0, "end_id": 1, "quote_id": 1, "kind": "relatable", "reason": "Identidad", "score": 88,
             "start": 9999, "quote": "Invented"},
            {"start_id": 99, "end_id": 1, "quote_id": 1, "kind": "relatable"},
        ]}):
            result = lyrical_moments(lines, 20, "groq")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["start"], 2)
        self.assertEqual(result[0]["end"], 10)
        self.assertEqual(result[0]["quote"], "quién soy")

    def test_trimming_does_not_reintroduce_earlier_lyrics(self):
        line = LyricLine(id=0, start=0, end=10, original="one two three four five six seven eight nine ten")
        cues = caption_cues([line], SubtitleStyle(mode="original", max_words=2), start=6, end=10)
        self.assertEqual([c["text"] for c in cues], ["SEVEN EIGHT", "NINE TEN"])
        self.assertEqual(cues[0]["start"], 0)
        self.assertEqual(cues[-1]["end"], 4)

    def test_translation_retries_empty_response_and_checkpoints_batches(self):
        lines = [LyricLine(id=i, start=i, end=i+1, original="Hello") for i in range(36)]
        blocks = []
        with patch("clipfinder.music.music_json", side_effect=[
            {"lines": [{"id": i, "text": "Hola"} for i in range(35)]},
            {"lines": [{"id": 35, "text": ""}]},
            {"lines": [{"id": 35, "text": "Hola"}]},
        ]) as provider:
            result = translate_lyrics(lines, progress_callback=lambda done, count, total: blocks.append((count, total)))
        self.assertEqual(blocks, [(35, 36), (36, 36)])
        self.assertEqual(provider.call_count, 3)
        self.assertEqual(len(result), 36)
        self.assertTrue(all(line.spanish == "Hola" for line in result))

    def test_export_framing_filter_has_portrait_and_horizontal_position(self):
        crop = video_filter(SubtitleStyle(crop_x=75))
        self.assertIn("scale=1080:1920", crop)
        self.assertIn("(iw-1080)*75/100", crop)
        fit = video_filter(SubtitleStyle(layout="vertical_fit"))
        self.assertIn("pad=1080:1920", fit)
        self.assertNotIn("crop", video_filter(SubtitleStyle(layout="original")))


if __name__ == "__main__":
    unittest.main()
