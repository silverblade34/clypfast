"""Audio/visual active speaker scoring using the MIT-licensed TalkNet model.

Weights: official TalkNet-ASD pretrained TalkSet checkpoint. No motion-only
heuristic is substituted when the audio/visual model is unavailable.
"""

import logging
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def _iou(a, b):
    overlap = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])) * max(
        0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return overlap / max(1, a[2] * a[3] + b[2] * b[3] - overlap)


def _tracks(samples, fps, cuts):
    tracks = []
    active = []
    previous = -1
    for frame, faces in sorted(samples.items()):
        if any(previous < cut <= frame for cut in cuts):
            active = []
        available = [t for t in active if frame - t[-1][0] <= fps * 0.4]
        for face in sorted(faces, key=lambda f: f[4], reverse=True):
            if face[4] < 0.7:
                continue
            match = max(available, key=lambda t: _iou(t[-1][1], face), default=None)
            if match is not None and _iou(match[-1][1], face) >= 0.25:
                match.append((frame, face))
                available.remove(match)
            else:
                match = [(frame, face)]
                tracks.append(match)
                active.append(match)
        active = [t for t in active if frame - t[-1][0] <= fps * 0.4]
        previous = frame
    return tracks


def _face_image(frame, box):
    x, y, w, h = box[:4]
    size = max(w, h) / 2
    cx, cy = x + w / 2, y + h / 2
    pad = int(size * 2) + 2
    padded = cv2.copyMakeBorder(frame, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(110, 110, 110))
    # Match the official TalkNet demo crop and central 112x112 preprocessing.
    region = padded[int(cy + pad - size):int(cy + pad + size * 1.8),
                    int(cx + pad - size * 1.4):int(cx + pad + size * 1.4)]
    gray = cv2.cvtColor(cv2.resize(region, (224, 224)), cv2.COLOR_BGR2GRAY)
    return gray[56:168, 56:168]


def select_active_speaker(input_path, samples, fps, cuts, progress_callback=None):
    """Return one selected face per sample, using synchronized face/audio scores."""
    try:
        import torch
        from python_speech_features import mfcc
        from clipfinder.vendor.talknet.talkNetModel import talkNetModel
    except ImportError as exc:
        raise RuntimeError('IA Smart necesita las dependencias de hablante activo: instala .[smart].') from exc
    checkpoint = Path(os.getenv("CLIPFINDER_TALKNET_MODEL", "outputs/models/talknet/pretrain_TalkSet.model"))
    if not checkpoint.is_file():
        raise RuntimeError("Faltan los pesos de TalkNet para IA Smart. Ejecuta python -m clipfinder.setup_smart.")
    tracks = [t for t in _tracks(samples, fps, cuts) if (t[-1][0] - t[0][0]) / fps >= 0.2]
    if not tracks:
        raise RuntimeError("IA Smart no detectó rostros fiables en este segmento; no se puede encuadrar al hablante.")
    audio_result = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(input_path), "-vn", "-ac", "1",
        "-ar", "16000", "-f", "s16le", "-",
    ], check=True, capture_output=True)
    audio = np.frombuffer(audio_result.stdout, dtype=np.int16)
    if len(audio) < 1600:
        raise RuntimeError("IA Smart necesita audio para identificar al hablante.")
    # Limit CPU inference threads to avoid starving the web server.
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    model = talkNetModel().eval()
    head = torch.nn.Linear(256, 2).eval()
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict({k[len('model.'):]: v for k, v in state.items() if k.startswith('model.')})
    head.load_state_dict({k[len('lossAV.FC.'):]: v for k, v in state.items() if k.startswith('lossAV.FC.')})

    # Decode once and retain only normalized face crops at the model's 25 fps.
    requests = {}
    prepared = []
    for track in tracks:
        start = int(np.ceil(track[0][0] / fps * 25))
        end = int(np.floor(track[-1][0] / fps * 25)) + 1
        times = np.arange(start, end) / 25
        original_times = np.array([i / fps for i, _ in track])
        boxes = np.array([f for _, f in track])
        interpolated = np.stack([np.interp(times, original_times, boxes[:, d]) for d in range(5)], axis=1)
        item = {"start": start, "faces": [], "track": track}
        prepared.append(item)
        for time, box in zip(times, interpolated):
            requests.setdefault(int(round(time * fps)), []).append((item, box))
    cap = cv2.VideoCapture(str(input_path))
    try:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            for item, box in requests.get(i, []):
                item["faces"].append(_face_image(frame, box))
            i += 1
    finally:
        cap.release()
    scored = {}
    for index, item in enumerate(prepared):
        if progress_callback:
            progress_callback(45, f"Identificando al hablante con audio y video ({index + 1}/{len(prepared)})...")
        start = item['start']
        faces = np.array(item['faces'])
        sound = audio[int(start / 25 * 16000):int((start + len(faces)) / 25 * 16000)]
        if len(sound) < 1600 or len(faces) < 5:
            continue
        features = mfcc(sound, 16000, numcep=13, winlen=0.025, winstep=0.010)
        length = min(len(faces), len(features) // 4)
        scores = []
        with torch.inference_mode():
            for offset in range(0, length, 100):
                count = min(100, length - offset)
                a = torch.from_numpy(features[offset * 4:(offset + count) * 4].astype(np.float32))[None]
                v = torch.from_numpy(faces[offset:offset + count].astype(np.float32))[None]
                ea = model.forward_audio_frontend(a)
                ev = model.forward_visual_frontend(v)
                ea, ev = model.forward_cross_attention(ea, ev)
                out = model.forward_audio_visual_backend(ea, ev)
                scores.extend(head(out)[:, 1].numpy().tolist())
        for frame, face in item['track']:
            position = int(round(frame / fps * 25)) - start
            if 0 <= position < len(scores):
                score = float(np.mean(scores[max(0, position - 6):position + 7]))
                scored.setdefault(frame, []).append((index, face, score))

    selected = {}
    current = None
    challenger = None
    challenge_start = 0
    previous = -1
    for frame in sorted(samples):
        if any(previous < cut <= frame for cut in cuts):
            current = None
        options = scored.get(frame, [])
        if options:
            best = max(options, key=lambda o: o[2])
            existing = next((o for o in options if o[0] == current), None)
            if existing is None:
                current = best[0]
                challenger = None
            elif best[0] != current and best[2] > existing[2] + 0.5 and best[2] > 0:
                if challenger != best[0]:
                    challenger, challenge_start = best[0], frame
                elif (frame - challenge_start) / fps >= 0.4:
                    current, challenger = best[0], None
            else:
                challenger = None
            chosen = next(o for o in options if o[0] == current)
            selected[frame] = [chosen[1]]
        else:
            selected[frame] = []
        previous = frame
    if not any(selected.values()):
        raise RuntimeError("No se pudo sincronizar audio y rostros para IA Smart.")
    logger.info("TalkNet scored %d face tracks", len(prepared))
    return selected
