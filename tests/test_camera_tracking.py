import unittest

from clipfinder.camera_tracking import camera_path, crop_contains_face, face_coverage


def face(x, size=100):
    return (x - size / 2, 100, size, size, 0.95)


class CameraTrackingTests(unittest.TestCase):
    def test_face_elsewhere_does_not_validate_table_crop(self):
        self.assertFalse(crop_contains_face([face(250), face(1650)], 960, 600))
        self.assertTrue(crop_contains_face([face(250), face(1650)], 1650, 600))

    def test_partial_face_is_not_safe(self):
        self.assertFalse(crop_contains_face([face(680, 160)], 960, 600))

    def test_long_detection_gap_uses_full_shot(self):
        coverage = face_coverage({0: [face(400)], 300: [face(400)]}, 330, 30)
        self.assertFalse(coverage[150])
        self.assertTrue(coverage[0])
        self.assertTrue(coverage[300])

    def test_face_before_cut_does_not_validate_empty_new_shot(self):
        coverage = face_coverage({29: [face(400)], 30: []}, 60, 30, {30})
        self.assertFalse(coverage[30])

    def test_delayed_first_detection_does_not_start_on_table(self):
        path = camera_path({0: [], 15: [face(400)]}, 90, 1920, 600, 30)
        self.assertEqual(path[0], 400)

    def test_alternating_face_sizes_do_not_switch_subject(self):
        samples = {i: [face(400, 100 + i % 2), face(1500, 101 - i % 2)] for i in range(90)}
        path = camera_path(samples, 90, 1920, 600, 30)
        self.assertLess(max(path) - min(path), 1)

    def test_missing_detections_hold_framing(self):
        path = camera_path({0: [face(400)], 5: []}, 90, 1920, 600, 30)
        self.assertEqual(path, [400] * 90)

    def test_distant_detection_must_persist_and_pan_is_limited(self):
        samples = {0: [face(400)], **{i: [face(1500)] for i in range(3, 90, 3)}}
        path = camera_path(samples, 90, 1920, 600, 30)
        self.assertEqual(path[18], 400)
        self.assertGreater(path[-1], 400)
        self.assertLessEqual(max(abs(b - a) for a, b in zip(path, path[1:])), 600 * 0.65 / 30 + 1e-6)

    def test_scene_cut_reframes_immediately(self):
        path = camera_path({0: [face(400)], 30: [face(1500)]}, 60, 1920, 600, 30, {30})
        self.assertEqual(path[29], 400)
        self.assertEqual(path[30], 1500)

    def test_split_side_does_not_follow_other_person(self):
        path = camera_path({0: [face(400), face(1500)], 3: [face(1500)]}, 60, 1920, 600, 30, side="left")
        self.assertEqual(path, [400] * 60)
