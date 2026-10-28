import unittest
from unittest.mock import patch

from clipfinder.analyzer import _validate_and_sanitize_clips, analyze_segments
from clipfinder.models import ClipCandidate, TranscriptSegment


def candidate(start=10, end=33, complete=True):
    return ClipCandidate(start_seconds=start, end_seconds=end, title="Relato",
                         reason="Relato", score=8, context_complete=complete)


class NarrativeSelectionTests(unittest.TestCase):
    def test_short_complete_story_is_allowed(self):
        self.assertEqual(len(_validate_and_sanitize_clips([candidate()])), 1)

    def test_long_incomplete_story_is_rejected(self):
        self.assertEqual(_validate_and_sanitize_clips([candidate(end=100, complete=False)]), [])

    def test_micro_clip_is_not_padded_with_unrelated_seconds(self):
        clip = candidate(end=18)
        self.assertEqual(_validate_and_sanitize_clips([clip], [TranscriptSegment(start=0, end=90, text="Otro tema")]), [])
        self.assertEqual(clip.end_seconds, 18)

    def test_long_complete_story_is_allowed(self):
        self.assertEqual(len(_validate_and_sanitize_clips([candidate(end=120)])), 1)

    def test_no_candidates_does_not_create_random_fallback_clips(self):
        with patch("clipfinder.analyzer._call_groq", return_value=[]):
            clips = analyze_segments([TranscriptSegment(start=0, end=60, text="Relleno")], "groq", "unused")
        self.assertEqual(clips, [])
