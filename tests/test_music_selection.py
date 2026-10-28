import unittest
from clipfinder.music import LyricLine, select_music_moments


class MusicSelectionTests(unittest.TestCase):
    def test_short_hooks_expand_and_total_is_four_across_categories(self):
        candidates = [dict(start=10+i*50, end=17+i*50, peak=13+i*50,
                           score=95-i, kind=['relatable', 'climax', 'chorus', 'energy'][i%4])
                      for i in range(6)]
        result = select_music_moments(candidates, [], 333)
        self.assertEqual(len(result), 4)
        for clip in result:
            self.assertAlmostEqual(clip['end']-clip['start'], 30)
            self.assertLessEqual(clip['start'], clip['peak'])
            self.assertGreaterEqual(clip['end'], clip['peak'])

    def test_song_edges_and_duplicate_ranges(self):
        candidates = [dict(start=0, end=7, score=99), dict(start=2, end=9, score=95),
                      dict(start=97, end=100, score=90)]
        result = select_music_moments(candidates, [], 100)
        self.assertEqual([(m['start'], m['end']) for m in result], [(0, 30), (70, 100)])
        self.assertEqual(select_music_moments(candidates, [], 19), [])

    def test_nearby_lyric_boundaries_preserve_minimum_and_quote(self):
        lines = [LyricLine(id=0, start=7, end=9, original='before'),
                 LyricLine(id=1, start=20, end=27, original='hook'),
                 LyricLine(id=2, start=36, end=38, original='after')]
        clip = select_music_moments([dict(start=20, end=27, peak=22)], lines, 100)[0]
        self.assertEqual((clip['start'], clip['end']), (7, 38))
        self.assertLessEqual(clip['start'], 20)
        self.assertGreaterEqual(clip['end'], 27)

    def test_legacy_small_duration_still_has_twenty_second_minimum(self):
        result = select_music_moments([dict(start=12, end=18)], [], 22, 15, 12)
        self.assertGreaterEqual(result[0]['end']-result[0]['start'], 20)
