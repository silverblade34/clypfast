"""Stable, time-based framing for sampled face detections."""

import math
from bisect import bisect_right


def crop_contains_face(faces, center, crop_width):
    """Require a reliable face to fit inside the proposed crop with headroom."""
    left, right = center - crop_width / 2, center + crop_width / 2
    return any(
        f[4] >= 0.7 and f[2] > 0 and f[3] > 0
        and f[0] >= left + crop_width * 0.04
        and f[0] + f[2] <= right - crop_width * 0.04
        for f in faces
    )


def face_coverage(samples, total_frames, fps, cuts=()):
    """Allow a tight crop only near a reliable detection in the same shot."""
    boundaries = sorted({0, *cuts, total_frames})
    detections = sorted(i for i, faces in samples.items() if any(f[4] >= 0.7 for f in faces))
    covered = []
    for frame in range(total_frames):
        shot = bisect_right(boundaries, frame) - 1
        pos = bisect_right(detections, frame)
        neighbors = detections[max(0, pos - 1):pos + 1]
        covered.append(any(
            boundaries[shot] <= i < boundaries[shot + 1] and abs(i - frame) <= fps * 0.75
            for i in neighbors
        ))
    return covered


def camera_path(samples, total_frames, width, crop_width, fps, cuts=(), side=None, hard_switch=False):
    samples = dict(samples)
    # Offline analysis lets each shot start at its first reliable face rather than
    # spending its opening frames looking at the center of the room.
    boundaries = sorted({0, *cuts, total_frames})
    for start, end in zip(boundaries, boundaries[1:]):
        first = next((faces for i, faces in sorted(samples.items()) if start <= i < end and any(
            f[4] >= 0.7 and (side is None or
                ((f[0] + f[2] / 2 < width / 2) == (side == "left"))) for f in faces
        )), None)
        if first:
            samples[start] = first
    center = width * ({"left": 0.25, "right": 0.75}.get(side, 0.5))
    target = center
    initialized = False
    pending = None
    pending_since = 0
    cut_frames = set(cuts)
    result = []
    fps = max(1.0, fps)
    for frame in range(total_frames):
        cut = frame in cut_frames
        if cut:
            initialized = False
            pending = None
        if frame in samples:
            faces = [f for f in samples[frame] if f[4] >= 0.7 and f[2] > 0 and f[3] > 0]
            if side:
                faces = [f for f in faces if (f[0] + f[2] / 2 < width / 2) == (side == "left")]
            if faces:
                largest = max(faces, key=lambda f: f[2] * f[3])
                nearest = min(faces, key=lambda f: abs(f[0] + f[2] / 2 - target))
                candidate = nearest if initialized else largest
                x = candidate[0] + candidate[2] / 2
                if not initialized:
                    center = target = x
                    initialized = True
                elif abs(x - target) <= crop_width * 0.45:
                    target = x
                    pending = None
                else:
                    # A distant face must persist before we abandon the current subject.
                    if pending is None or abs(x - pending) > crop_width * 0.2:
                        pending, pending_since = x, frame
                    elif (frame - pending_since) / fps >= 0.6:
                        target = x
                        if hard_switch:
                            center = x  # Cut to the other speaker; do not pan through the table.
                        pending = None
            else:
                pending = None  # Keep the last framing through brief missed detections.
        delta = target - center
        dead_zone = crop_width * 0.08
        if abs(delta) > dead_zone:
            step = (abs(delta) - dead_zone) * (1 - math.exp(-1 / (fps * 0.35)))
            center += math.copysign(min(step, crop_width * 0.65 / fps), delta)
        center = min(width - crop_width / 2, max(crop_width / 2, center))
        result.append(center)
    return result
