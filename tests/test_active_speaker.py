import unittest

import numpy as np

from clipfinder.active_speaker import _face_image, _tracks
from clipfinder.camera_tracking import camera_path


def face(x):
    return (x - 50, 50, 100, 100, 0.95)


class ActiveSpeakerTests(unittest.TestCase):
    def test_tracks_keep_identity_when_detection_order_changes(self):
        tracks = _tracks({0: [face(300), face(1500)], 3: [face(1505), face(305)]}, 30, set())
        self.assertEqual(len(tracks), 2)
        self.assertTrue(all(len(t) == 2 for t in tracks))
        self.assertTrue(all(abs(t[0][1][0] - t[-1][1][0]) < 10 for t in tracks))

    def test_tracks_never_cross_scene_cuts(self):
        tracks = _tracks({0: [face(300)], 3: [face(300)]}, 30, {3})
        self.assertEqual(len(tracks), 2)

    def test_switch_cuts_directly_without_traversing_empty_table(self):
        samples = {0: [face(300)], **{i: [face(1500)] for i in range(3, 90, 3)}}
        path = camera_path(samples, 90, 1920, 600, 30, hard_switch=True)
        self.assertTrue(all(x in (300, 1500) for x in path))
        self.assertEqual(path[-1], 1500)

    def test_model_face_crop_handles_edges_and_shape(self):
        image = np.zeros((180, 320, 3), np.uint8)
        crop = _face_image(image, (-10, -10, 100, 100, 0.95))
        self.assertEqual(crop.shape, (112, 112))
