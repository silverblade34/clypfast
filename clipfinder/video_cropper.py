"""Video cropping and smart reframing module for ClipFinder.

Supports:
- Slicing exact video timestamps using yt-dlp / ffmpeg.
- Level 1: 9:16 Vertical with blurred background.
- Level 2: 9:16 Smart Face Tracking with smoothed virtual camera.
- Level 3: 9:16 Dual Speaker / Podcast Split-Screen (stacked vertically).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)

YUNET_MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
CACHE_DIR = Path.home() / ".cache" / "clipfinder"


def get_yunet_model_path() -> Path:
    """Ensure the YuNet ONNX model is available locally, downloading if necessary."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    model_path = CACHE_DIR / "face_detection_yunet_2023mar.onnx"
    if not model_path.exists() or model_path.stat().st_size < 100_000:
        logger.info("Downloading YuNet face detection model to %s...", model_path)
        urllib.request.urlretrieve(YUNET_MODEL_URL, str(model_path))
    return model_path


def download_clip_segment(
    source: str,
    start_sec: float,
    end_sec: float,
    output_path: Path,
    progress_callback: Callable[[int, str], None] | None = None,
) -> Path:
    """
    Download or slice a specific clip segment from YouTube or a local file.
    Does NOT download the entire video when given a YouTube URL.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    is_url = source.startswith("http://") or source.startswith("https://")

    if progress_callback:
        progress_callback(10, "Extrayendo segmento de video...")

    if is_url:
        import yt_dlp
        from yt_dlp.utils import download_range_func

        range_fn: Any = download_range_func
        ydl_opts: Any = {
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "download_ranges": range_fn(None, [(start_sec, end_sec)]),
            "force_keyframes_at_cuts": True,
            "outtmpl": str(output_path),
            "quiet": True,
            "no_warnings": True,
            "overwrites": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([source])
    else:
        # Local video file: slice using ffmpeg
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(start_sec),
            "-to",
            str(end_sec),
            "-i",
            source,
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-avoid_negative_ts",
            "make_zero",
            str(output_path),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not output_path.exists():
        raise FileNotFoundError(f"Failed to generate clip segment at {output_path}")

    if progress_callback:
        progress_callback(30, "Segmento descargado con éxito.")

    return output_path


def crop_video_blur(
    input_path: Path,
    output_path: Path,
    progress_callback: Callable[[int, str], None] | None = None,
) -> Path:
    """
    Convert a 16:9 video to a 9:16 vertical video using blurred background.
    Fast and 100% reliable with ffmpeg hardware acceleration.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if progress_callback:
        progress_callback(50, "Renderizando 9:16 con fondo difuminado...")

    filter_complex = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];"
        "[0:v]scale=1080:-1[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2[outv]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-filter_complex",
        filter_complex,
        "-map",
        "[outv]",
        "-map",
        "0:a?",
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "5M",
        "-c:a",
        "aac",
        str(output_path),
    ]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        # Fallback to libx264 if hardware encoder fails
        cmd[cmd.index("h264_videotoolbox")] = "libx264"
        cmd.remove("-b:v")
        cmd.remove("5M")
        cmd.extend(["-crf", "22", "-preset", "fast"])
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if progress_callback:
        progress_callback(100, "¡Renderizado vertical completado!")

    return output_path


def _detect_faces_yunet(
    detector: cv2.FaceDetectorYN,
    frame: np.ndarray,
    orig_w: int,
    orig_h: int,
) -> list[tuple[float, float, float, float, float]]:
    """
    Detect faces on a frame using YuNet.
    Returns list of (x, y, w, h, score).
    """
    detector.setInputSize((orig_w, orig_h))
    _, detections = detector.detect(frame)
    results: list[tuple[float, float, float, float, float]] = []
    if detections is not None:
        for det in detections:
            x, y, w, h = det[0], det[1], det[2], det[3]
            score = det[14]
            if score >= 0.5:
                results.append((float(x), float(y), float(w), float(h), float(score)))
    return results


def crop_video_smart(
    input_path: Path,
    output_path: Path,
    mode: str = "auto",
    progress_callback: Callable[[int, str], None] | None = None,
) -> Path:
    """
    Convert video to 9:16 vertical using AI Face Tracking or Dual Speaker Split.
    
    Modes:
    - 'smart_track': Virtual camera smoothly following single speaker.
    - 'split_screen': Stacked vertical layout for two speakers (e.g. podcast).
    - 'auto': Automatically selects 'split_screen' if two speakers are detected,
              otherwise 'smart_track'.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model_path = get_yunet_model_path()

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {input_path}")

    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    # If video is already vertical (e.g. 9:16), copy directly
    if orig_h > orig_w:
        cap.release()
        shutil.copyfile(input_path, output_path)
        return output_path

    target_w = 1080
    target_h = 1920
    crop_w = int(orig_h * (9 / 16))  # 9:16 width inside original height

    detector = cv2.FaceDetectorYN.create(str(model_path), "", (orig_w, orig_h))

    # ── Phase 1: Fast Pass - Analyze face positions across frames ─────────────
    if progress_callback:
        progress_callback(35, "Analizando oradores y posiciones faciales con IA...")

    sample_step = max(1, int(fps / 10))  # sample ~10 times per second
    frame_faces: dict[int, list[tuple[float, float, float, float, float]]] = {}

    frame_idx = 0
    dual_speaker_hits = 0
    sampled_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_step == 0:
            sampled_count += 1
            faces = _detect_faces_yunet(detector, frame, orig_w, orig_h)
            frame_faces[frame_idx] = faces

            # Check if there are 2 distinct faces separated horizontally (podcast layout)
            if len(faces) >= 2:
                # Sort by X coordinate
                sorted_faces = sorted(faces, key=lambda f: f[0])
                left_f = sorted_faces[0]
                right_f = sorted_faces[-1]
                # If they are sufficiently apart (e.g. left in left 48%, right in right 48%)
                if left_f[0] + left_f[2] / 2 < orig_w * 0.48 and right_f[0] + right_f[2] / 2 > orig_w * 0.52:
                    dual_speaker_hits += 1

        frame_idx += 1

    # Decide mode if auto
    chosen_mode = mode
    if chosen_mode == "auto":
        is_podcast_dual = (sampled_count > 0) and (dual_speaker_hits / sampled_count >= 0.30)
        chosen_mode = "split_screen" if is_podcast_dual else "smart_track"

    logger.info("Smart crop selected mode: %s (dual hits: %d/%d)", chosen_mode, dual_speaker_hits, sampled_count)

    # ── Phase 2: Compute Smoothed Trajectories ────────────────────────────────
    raw_targets: list[float] = []
    left_targets: list[float] = []
    right_targets: list[float] = []

    last_center_x = float(orig_w / 2)
    last_left_x = float(orig_w * 0.25)
    last_right_x = float(orig_w * 0.75)

    for i in range(total_frames):
        # Find nearest sampled frame
        nearest_sample = min(frame_faces.keys(), key=lambda k: abs(k - i), default=None)
        faces = frame_faces.get(nearest_sample, []) if nearest_sample is not None else []

        if faces:
            # Sort by area (largest face = primary speaker)
            faces_by_area = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            primary = faces_by_area[0]
            last_center_x = primary[0] + primary[2] / 2

            # For split screen: find left and right speakers
            faces_by_x = sorted(faces, key=lambda f: f[0])
            last_left_x = faces_by_x[0][0] + faces_by_x[0][2] / 2
            last_right_x = faces_by_x[-1][0] + faces_by_x[-1][2] / 2

        raw_targets.append(last_center_x)
        left_targets.append(last_left_x)
        right_targets.append(last_right_x)

    # Apply Exponential Moving Average (EMA) smoothing for virtual camera
    smoothed_center: list[float] = []
    curr = raw_targets[0] if raw_targets else float(orig_w / 2)
    alpha = 0.08  # smooth camera pan
    for t in raw_targets:
        curr = alpha * t + (1 - alpha) * curr
        smoothed_center.append(curr)

    smoothed_left: list[float] = []
    curr_l = left_targets[0] if left_targets else float(orig_w * 0.25)
    for t in left_targets:
        curr_l = alpha * t + (1 - alpha) * curr_l
        smoothed_left.append(curr_l)

    smoothed_right: list[float] = []
    curr_r = right_targets[0] if right_targets else float(orig_w * 0.75)
    for t in right_targets:
        curr_r = alpha * t + (1 - alpha) * curr_r
        smoothed_right.append(curr_r)

    # ── Phase 3: Render Frames & Pipe to ffmpeg ────────────────────────────────
    if progress_callback:
        mode_label = "Pantalla Dividida (Podcast)" if chosen_mode == "split_screen" else "Seguimiento Inteligente"
        progress_callback(55, f"Renderizando en formato vertical 9:16 ({mode_label})...")

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # ffmpeg pipe command with hardware acceleration
    pipe_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-s",
        f"{target_w}x{target_h}",
        "-pix_fmt",
        "bgr24",
        "-r",
        str(fps),
        "-i",
        "-",
        "-i",
        str(input_path),
        "-map",
        "0:v",
        "-map",
        "1:a?",
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "6M",
        "-c:a",
        "aac",
        "-shortest",
        str(output_path),
    ]

    pipe_proc = None
    try:
        pipe_proc = subprocess.Popen(pipe_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except Exception as exc:
        logger.warning("Hardware encoder failed, falling back to libx264: %s", exc)
        pipe_cmd[pipe_cmd.index("h264_videotoolbox")] = "libx264"
        pipe_cmd.remove("-b:v")
        pipe_cmd.remove("6M")
        pipe_cmd.extend(["-crf", "21", "-preset", "veryfast"])
        pipe_proc = subprocess.Popen(pipe_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    frame_num = 0
    split_h = target_h // 2  # 960 each
    crop_w_split = int(orig_h * (target_w / split_h))  # aspect ratio 9:8

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if chosen_mode == "split_screen":
                # ── Stacked Split Screen Layout ───────────────────────────────
                # Top speaker (Host/Left)
                center_l = smoothed_left[min(frame_num, len(smoothed_left) - 1)]
                start_x_l = int(max(0, min(orig_w - crop_w_split, center_l - crop_w_split / 2)))
                crop_top = frame[0:orig_h, start_x_l : start_x_l + crop_w_split]
                top_resized = cv2.resize(crop_top, (target_w, split_h))

                # Bottom speaker (Guest/Right)
                center_r = smoothed_right[min(frame_num, len(smoothed_right) - 1)]
                start_x_r = int(max(0, min(orig_w - crop_w_split, center_r - crop_w_split / 2)))
                crop_bottom = frame[0:orig_h, start_x_r : start_x_r + crop_w_split]
                bottom_resized = cv2.resize(crop_bottom, (target_w, split_h))

                # Combine vertically
                final_frame = np.vstack([top_resized, bottom_resized])

                # Draw an elegant separator line in the middle (accent color)
                cv2.line(final_frame, (0, split_h), (target_w, split_h), (50, 50, 50), 3)

            else:
                # ── Single Speaker Dynamic Smart Tracking ─────────────────────
                center_x = smoothed_center[min(frame_num, len(smoothed_center) - 1)]
                start_x = int(max(0, min(orig_w - crop_w, center_x - crop_w / 2)))
                cropped = frame[0:orig_h, start_x : start_x + crop_w]
                final_frame = cv2.resize(cropped, (target_w, target_h))

            # Write raw frame to ffmpeg stdin
            assert pipe_proc.stdin is not None
            pipe_proc.stdin.write(final_frame.tobytes())

            frame_num += 1
            if progress_callback and frame_num % max(1, int(fps * 2)) == 0:
                pct = 55 + int((frame_num / total_frames) * 40)
                progress_callback(min(95, pct), "Procesando fotogramas verticales...")

    finally:
        cap.release()
        if pipe_proc and pipe_proc.stdin:
            pipe_proc.stdin.close()
            pipe_proc.wait()

    if progress_callback:
        progress_callback(100, "¡Clip vertical con IA completado!")

    return output_path


def process_clip(
    source: str,
    start_sec: float,
    end_sec: float,
    output_path: Path,
    mode: str = "smart_vertical",
    subtitle_theme: str = "hormozi",
    include_hook_title: bool = True,
    normalize_audio: bool = True,
    clip_title: str | None = None,
    words_data: list[dict[str, Any]] | None = None,
    progress_callback: Callable[[int, str], None] | None = None,
    # --- Overrides de personalización del modal ---
    hook_title_custom: str | None = None,
    hook_duration: float | None = None,
    hook_theme: str | None = None,
    sub_font: str | None = None,
    sub_base_color: str | None = None,
    sub_highlight_color: str | None = None,
    sub_margin_v: int | None = None,
) -> Path:
    """
    High-level orchestrator: Slices clip and applies requested formatting.

    Modes:
    - 'original': 16:9 high quality cut.
    - 'vertical_blur': 9:16 with blurred video background.
    - 'smart_vertical': 9:16 with AI Face Tracking (auto split-screen for podcasts).
    - 'smart_track': 9:16 single speaker face tracking.
    - 'split_screen': 9:16 dual speaker stacked podcast layout.
    """
    from clipfinder.subtitles_burner import generate_ass_subtitles

    temp_dir = CACHE_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    stem = output_path.stem
    temp_raw = temp_dir / f"raw_{stem}.mp4"
    temp_cropped = temp_dir / f"crop_{stem}.mp4"
    temp_ass = temp_dir / f"subs_{stem}.ass"

    try:
        # Step 1: Download / extract original 16:9 segment
        download_clip_segment(source, start_sec, end_sec, temp_raw, progress_callback)

        # Step 2: Apply crop transformation
        if mode == "original":
            shutil.copyfile(temp_raw, temp_cropped)
        elif mode == "vertical_blur":
            crop_video_blur(temp_raw, temp_cropped, progress_callback)
        elif mode in ("smart_vertical", "smart_track", "split_screen"):
            actual_mode = "auto" if mode == "smart_vertical" else mode
            crop_video_smart(temp_raw, temp_cropped, mode=actual_mode, progress_callback=progress_callback)
        else:
            raise ValueError(f"Unknown crop mode: {mode}")

        # Step 3: Subtitles and Audio Normalization (Loudnorm)
        has_subtitles = subtitle_theme != "none" and bool(words_data)
        if has_subtitles or normalize_audio:
            if progress_callback:
                progress_callback(88, "Quemando subtítulos y normalizando audio...")

            vf_filters: list[str] = []
            if has_subtitles and words_data:
                generate_ass_subtitles(
                    clip_title=clip_title if include_hook_title else None,
                    words=words_data,
                    output_ass_path=temp_ass,
                    theme=subtitle_theme,
                    include_hook_title=include_hook_title,
                    # Propagación de overrides del modal
                    hook_title_custom=hook_title_custom,
                    hook_duration=hook_duration,
                    hook_theme=hook_theme,
                    sub_font=sub_font,
                    sub_base_color=sub_base_color,
                    sub_highlight_color=sub_highlight_color,
                    sub_margin_v=sub_margin_v,
                )
                # Escape path for ffmpeg subtitles filter
                escaped_ass = str(temp_ass).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
                vf_filters.append(f"subtitles='{escaped_ass}'")

            cmd = ["ffmpeg", "-y", "-i", str(temp_cropped)]
            if vf_filters:
                cmd.extend(["-vf", ",".join(vf_filters)])

            if normalize_audio:
                cmd.extend(["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])

            cmd.extend([
                "-c:v", "h264_videotoolbox",
                "-b:v", "6M",
                "-c:a", "aac",
                "-b:a", "192k",
                str(output_path),
            ])

            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                # Fallback to libx264
                cmd[cmd.index("h264_videotoolbox")] = "libx264"
                cmd.remove("-b:v")
                cmd.remove("6M")
                cmd.extend(["-crf", "20", "-preset", "veryfast"])
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            shutil.copyfile(temp_cropped, output_path)

        return output_path

    finally:
        for f in (temp_raw, temp_cropped, temp_ass):
            if f.exists():
                f.unlink(missing_ok=True)

