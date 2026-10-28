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
import re
import shutil
import subprocess
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from clipfinder.camera_tracking import camera_path
from clipfinder.youtube_access import YoutubeSessionRequired, download_error_message, requires_youtube_login, youtube_options

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
    youtube_browser: str | None = None,
) -> Path:
    """
    Download or slice a specific clip segment from YouTube or a local file.
    Does NOT download the entire video when given a YouTube URL.
    """
    if start_sec < 0 or end_sec <= start_sec:
        raise ValueError("El intervalo del clip debe tener inicio positivo y fin posterior al inicio.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    download_error: Exception | None = None
    is_url = source.startswith("http://") or source.startswith("https://")

    if progress_callback:
        progress_callback(10, "Extrayendo segmento de video...")

    if is_url:
        import yt_dlp
        from yt_dlp.utils import download_range_func

        range_fn: Any = download_range_func
        ydl_opts: Any = {
            **youtube_options(source, browser_override=youtube_browser),
            # Prefer H.264 so OpenCV can decode without transcoding;
            # fall back to best available if H.264 is not offered.
            "format": "bestvideo[vcodec^=avc1]+bestaudio/bestvideo[vcodec^=h264]+bestaudio/bestvideo+bestaudio/best",
            "download_ranges": range_fn(None, [(start_sec, end_sec)]),
            "force_keyframes_at_cuts": True,
            "outtmpl": str(output_path.with_suffix("")) + ".%(ext)s",
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "overwrites": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([source])
        except Exception as ydl_err:
            download_error = ydl_err
            if requires_youtube_login(ydl_err):
                raise YoutubeSessionRequired(download_error_message(ydl_err)) from ydl_err
            logger.warning("yt-dlp range download error: %s, checking for stream fallback", ydl_err)

        # If yt-dlp saved as .webm, .mkv or .mp4.webm, remux cleanly to output_path
        if not output_path.exists() or output_path.stat().st_size < 1000:
            stem = output_path.stem
            parent = output_path.parent
            candidates = [
                p for p in parent.glob(f"{stem}*")
                if p != output_path and p.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}
                and not re.search(r"\.f\d+$", p.stem)
                and p.is_file() and p.stat().st_size > 1000
            ]
            if candidates:
                best_file = max(candidates, key=lambda f: f.stat().st_size)
                remux_cmd = [
                    "ffmpeg", "-y", "-i", str(best_file),
                    "-c", "copy",
                    str(output_path),
                ]
                try:
                    subprocess.run(remux_cmd, check=True, capture_output=True, text=True)
                except subprocess.CalledProcessError as remux_err:
                    download_error = remux_err
                else:
                    best_file.unlink(missing_ok=True)

        # Secondary fallback for HLS/Twitch/Kick if range cutting didn't generate output
        if not output_path.exists() or output_path.stat().st_size < 1000:
            try:
                probe_opts = {**youtube_options(source, browser_override=youtube_browser), "quiet": True, "format": "bestvideo+bestaudio/best"}
                with yt_dlp.YoutubeDL(probe_opts) as ydl:
                    info = ydl.extract_info(source, download=False)
                    streams = (info.get("requested_formats") or [info]) if info else []
                    streams = [stream for stream in streams if stream.get("url")]
                    if streams:
                        dur = max(1.0, end_sec - start_sec)
                        cmd = ["ffmpeg", "-y", "-nostdin"]
                        for stream in streams:
                            headers = stream.get("http_headers") or info.get("http_headers") or {}
                            if headers:
                                cmd += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
                            cmd += ["-ss", str(start_sec), "-i", stream["url"]]
                        video_index = next((i for i, s in enumerate(streams) if s.get("vcodec") != "none"), 0)
                        audio_index = next((i for i, s in enumerate(streams) if s.get("acodec") != "none"), video_index)
                        cmd += [
                            "-map", f"{video_index}:v:0", "-map", f"{audio_index}:a:0?",
                            "-t", str(dur), "-c:v", "libx264", "-c:a", "aac",
                            "-avoid_negative_ts", "make_zero", str(output_path),
                        ]
                        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=300)
                    else:
                        raise RuntimeError("El proveedor no devolvió URLs de video descargables.")
            except Exception as fb_err:
                download_error = fb_err
                logger.warning("FFmpeg HLS stream slice fallback failed: %s", fb_err)
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

    if not output_path.exists() or output_path.stat().st_size < 1000:
        detail = download_error_message(download_error) if download_error else "El archivo está vacío o incompleto."
        if isinstance(download_error, subprocess.CalledProcessError):
            detail = (download_error.stderr or detail)[-2000:]
        raise RuntimeError(f"No se pudo extraer el segmento de video: {detail}") from download_error

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

    # scale=1080:-2 ensures even height (divisible by 2) required by H.264 encoders
    filter_complex = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];"
        "[0:v]scale=1080:-2[fg];"
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
        "-pix_fmt",
        "yuv420p",
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
        # Fallback to libx264 if hardware encoder fails — ensure output_path is last argument!
        cmd_fb = [
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
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-crf",
            "22",
            "-preset",
            "fast",
            "-c:a",
            "aac",
            str(output_path),
        ]
        subprocess.run(cmd_fb, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
    # YuNet misses large/profile faces when fed full 1080p/4K frames.
    scale = min(1.0, 960.0 / orig_w)
    image = cv2.resize(frame, (int(orig_w * scale), int(orig_h * scale))) if scale < 1 else frame
    detector.setInputSize((image.shape[1], image.shape[0]))
    detector.setScoreThreshold(0.7)
    _, detections = detector.detect(image)
    results: list[tuple[float, float, float, float, float]] = []
    if detections is not None:
        for det in detections:
            x, y, w, h = det[0], det[1], det[2], det[3]
            score = det[14]
            if score >= 0.5:
                results.append((float(x / scale), float(y / scale), float(w / scale), float(h / scale), float(score)))
    return results


def _open_tracking_video(input_path: Path) -> cv2.VideoCapture:
    """Check decoding and convert unsupported codecs before face tracking."""
    cap = cv2.VideoCapture(str(input_path))
    readable, _ = cap.read() if cap.isOpened() else (False, None)
    if readable:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        return cap
    cap.release()

    compatible = input_path.with_name(f"{input_path.stem}_compatible.mp4")
    converted = False
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-nostdin",
                # Tolerate minor container errors (truncated segments, missing moov, etc.)
                "-fflags", "+genpts+igndts",
                "-err_detect", "ignore_err",
                "-v", "warning",
                "-i", str(input_path),
                "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "fast",
                "-crf", "18", "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                # Re-generate timestamps to avoid negative PTS issues
                "-avoid_negative_ts", "make_zero",
                str(compatible),
            ],
            check=True, capture_output=True, text=True,
        )
        cap = cv2.VideoCapture(str(compatible))
        readable, _ = cap.read() if cap.isOpened() else (False, None)
        cap.release()
        if not readable:
            raise ValueError("El segmento convertido tampoco contiene cuadros legibles.")
        # Replace input_path with the converted file so the rest of the pipeline
        # reads the H.264-encoded version. Mark as converted so finally does not
        # delete the destination file.
        compatible.replace(input_path)
        converted = True
    except subprocess.CalledProcessError as exc:
        logger.warning("Cannot decode clip segment: %s", exc.stderr)
        raise ValueError(
            "El segmento descargado está incompleto o no contiene un video válido. "
            "Vuelve a exportar el clip; si persiste, utiliza el archivo de video local."
        ) from exc
    finally:
        # Only delete the temp compatible file if the rename did NOT happen yet.
        # After compatible.replace(input_path) the source path no longer exists,
        # so unlink would be a no-op anyway, but being explicit avoids confusion.
        if not converted:
            compatible.unlink(missing_ok=True)
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        cap.release()
        raise ValueError("No se pudo abrir el segmento convertido para el seguimiento facial.")
    return cap


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
    - 'auto': Vertical crop following the audio/visual active speaker.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cap = _open_tracking_video(input_path)

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

    model_path = get_yunet_model_path()
    detector = cv2.FaceDetectorYN.create(str(model_path), "", (orig_w, orig_h))

    # ── Phase 1: Fast Pass - Analyze face positions across frames ─────────────
    if progress_callback:
        progress_callback(35, "Analizando oradores y posiciones faciales con IA...")

    sample_step = max(1, int(fps / 10))  # sample ~10 times per second
    frame_faces: dict[int, list[tuple[float, float, float, float, float]]] = {}

    frame_idx = 0
    dual_speaker_hits = 0
    sampled_count = 0
    cuts: set[int] = set()
    previous_preview = None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        preview = cv2.resize(frame, (64, 36)).astype(np.float32) / 255.0
        scene_cut = previous_preview is not None and float(np.mean(np.abs(preview - previous_preview))) > 0.10
        previous_preview = preview
        if scene_cut:
            cuts.add(frame_idx)
        if frame_idx % sample_step == 0 or scene_cut:
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
        chosen_mode = "smart_track"

    logger.info("Smart crop selected mode: %s (dual hits: %d/%d)", chosen_mode, dual_speaker_hits, sampled_count)

    # ── Phase 2: Compute Smoothed Trajectories ────────────────────────────────
    # Use the actual decoded length, which can differ from container metadata.
    total_frames = frame_idx
    if not total_frames:
        cap.release()
        raise ValueError("El segmento no contiene cuadros de video legibles.")
    # IA Smart keeps its vertical format and uses audio/visual speaker scores.
    if chosen_mode != "split_screen":
        from clipfinder.active_speaker import select_active_speaker
        try:
            selected_faces = select_active_speaker(input_path, frame_faces, fps, cuts, progress_callback)
        except Exception:
            cap.release()
            raise
        if os.getenv("CLIPFINDER_TRACKING_DEBUG"):
            import json
            output_path.with_suffix(".tracking.json").write_text(json.dumps({
                "fps": fps, "width": orig_w, "cuts": sorted(cuts),
                "faces": frame_faces, "selected": selected_faces,
            }), encoding="utf-8")
        smoothed_center = camera_path(selected_faces, total_frames, orig_w, crop_w, fps, cuts, hard_switch=True)
    else:
        smoothed_center = camera_path(frame_faces, total_frames, orig_w, crop_w, fps, cuts)
    split_width = min(orig_w, int(orig_h * (1080 / 960)))
    smoothed_left = camera_path(frame_faces, total_frames, orig_w, split_width, fps, cuts, "left")
    smoothed_right = camera_path(frame_faces, total_frames, orig_w, split_width, fps, cuts, "right")

    # ── Phase 3: Render Frames & Pipe to ffmpeg ────────────────────────────────
    if progress_callback:
        mode_label = "Pantalla Dividida (Podcast)" if chosen_mode == "split_screen" else "Seguimiento Inteligente"
        progress_callback(55, f"Renderizando en formato vertical 9:16 ({mode_label})...")

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # A pipe cannot replay frames after a hardware encoder fails asynchronously.
    # Use the portable encoder and check its exit status before reporting success.
    pipe_cmd = [
        "ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{target_w}x{target_h}", "-pix_fmt", "bgr24", "-r", str(fps),
        "-i", "-", "-i", str(input_path), "-map", "0:v", "-map", "1:a?",
        "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "21",
        "-preset", "veryfast", "-c:a", "aac", "-shortest", str(output_path),
    ]
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

    if pipe_proc.returncode != 0:
        raise RuntimeError("FFmpeg no pudo completar el renderizado vertical.")

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
    youtube_browser: str | None = None,
) -> Path:
    """
    High-level orchestrator: Slices clip and applies requested formatting.

    Modes:
    - 'original': 16:9 high quality cut.
    - 'vertical_blur': 9:16 with blurred video background.
    - 'smart_vertical': 9:16 with audio/visual active speaker tracking.
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
        if youtube_browser:
            download_clip_segment(source, start_sec, end_sec, temp_raw, progress_callback, youtube_browser=youtube_browser)
        else:
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
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "h264_videotoolbox",
                "-b:v",
                "6M",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                str(output_path),
            ])

            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                # Fallback to libx264 cleanly
                cmd_fb = ["ffmpeg", "-y", "-i", str(temp_cropped)]
                if vf_filters:
                    cmd_fb.extend(["-vf", ",".join(vf_filters)])
                if normalize_audio:
                    cmd_fb.extend(["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
                cmd_fb.extend([
                    "-pix_fmt",
                    "yuv420p",
                    "-c:v",
                    "libx264",
                    "-crf",
                    "20",
                    "-preset",
                    "veryfast",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    str(output_path),
                ])
                subprocess.run(cmd_fb, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            shutil.copyfile(temp_cropped, output_path)

        return output_path

    finally:
        for f in (temp_raw, temp_cropped, temp_ass):
            if f.exists():
                f.unlink(missing_ok=True)

