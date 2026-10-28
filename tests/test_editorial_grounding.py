import json
import unittest
from pathlib import Path
from unittest.mock import patch

from clipfinder.analyzer import enrich_clip_social_content, strict_clip_segments
from clipfinder.models import ClipCandidate, TranscriptSegment, LLMSocialContentResponse


class EditorialGroundingTests(unittest.TestCase):
    def test_neighboring_long_segment_is_excluded(self):
        clip = ClipCandidate(start_seconds=837, end_seconds=888, title="x", reason="x", score=7)
        segments = [TranscriptSegment(start=877, end=883, text="El valor de la colaboración."),
                    TranscriptSegment(start=889, end=918, text="Muchachos con talento.")]
        self.assertEqual([s.text for s in strict_clip_segments(clip, segments)], ["El valor de la colaboración."])

    def test_partial_segment_uses_word_timestamps(self):
        clip = ClipCandidate(start_seconds=10, end_seconds=12, title="x", reason="x", score=7)
        segment = TranscriptSegment(start=9, end=13, text="antes dentro después", words=[
            {"word": "antes", "start": 9, "end": 10},
            {"word": "dentro", "start": 10, "end": 11},
            {"word": "después", "start": 12, "end": 13},
        ])
        self.assertEqual(strict_clip_segments(clip, [segment])[0].text, "dentro")

    def test_unsupported_quote_cannot_overwrite_clip(self):
        clip = ClipCandidate(start_seconds=10, end_seconds=20, title="Título anterior", reason="x", score=7)
        response = LLMSocialContentResponse(core_idea="x", surface_topic="x", hidden_angle="x",
            hook="Título incorrecto", quote="Una frase de otro tramo", social_description="x",
            engagement_question="x")
        with patch("clipfinder.analyzer._call_groq_stage2", return_value=response):
            with self.assertRaisesRegex(ValueError, "No se guardó"):
                enrich_clip_social_content(clip, [TranscriptSegment(start=11, end=19, text="Valores y colaboración.")], "groq", "unused")
        self.assertEqual(clip.title, "Título anterior")
