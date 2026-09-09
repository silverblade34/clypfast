"""Groq Whisper transcriber — uses Groq's ultra-fast LPU cloud infrastructure (whisper-large-v3)."""

from __future__ import annotations

import logging
import math
import os
import subprocess
from collections.abc import Callable
from pathlib import Path

from clipfinder.models import TranscriptSegment

logger = logging.getLogger(__name__)

# Max payload size for Groq audio endpoint is 25 MB; we use 22 MB safety threshold
MAX_GROQ_BYTES = 22 * 1024 * 1024


def transcribe_with_groq(
    audio_path: Path,
    api_key: str | None = None,
    language: str | None = None,
    model: str = "whisper-large-v3-turbo",
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[list[TranscriptSegment], float]:
    """
    Transcribe audio using Groq Whisper Cloud (whisper-large-v3 or whisper-large-v3-turbo).

    Args:
        audio_path: Path to the audio file.
        api_key: Groq API key. If None, reads from GROQ_API_KEY environment variable.
        language: Language code (e.g. 'es', 'en'). None = auto-detect.
        model: 'whisper-large-v3' or 'whisper-large-v3-turbo'.
        progress_callback: Optional fn(pct: int, n_segments: int).

    Returns:
        tuple (segments, audio_duration_seconds)
    """
    from groq import Groq

    resolved_key = api_key or os.getenv("GROQ_API_KEY")
    if not resolved_key:
        raise ValueError("GROQ_API_KEY is required for Groq Whisper transcription.")

    client = Groq(api_key=resolved_key)

    # 1. Probe total duration of audio
    total_duration = _probe_duration(audio_path)

    # 2. Compress audio to 32kbps 16kHz mono MP3 to minimize file size
    compressed_path = audio_path.parent / f"{audio_path.stem}_groq_opt.mp3"
    _compress_audio(audio_path, compressed_path)

    try:
        file_size = compressed_path.stat().st_size

        if file_size <= MAX_GROQ_BYTES:
            # Single file request
            logger.info("Transcribing audio directly with Groq (%s, %.1f MB)...", model, file_size / 1024 / 1024)
            segments = _transcribe_file(
                client=client,
                file_path=compressed_path,
                model=model,
                language=language,
                time_offset=0.0,
            )
            if progress_callback:
                progress_callback(100, len(segments))
            duration = total_duration or (segments[-1].end if segments else 0.0)
            return segments, round(duration, 2)

        # File exceeds max size: split into chunks (e.g. 10 minutes each)
        chunk_duration_sec = 600  # 10 minutes
        num_chunks = math.ceil(total_duration / chunk_duration_sec)
        logger.info(
            "Audio file is %.1f MB; splitting into %d chunks of ~10 minutes for Groq...",
            file_size / 1024 / 1024,
            num_chunks,
        )

        chunk_files = _split_audio(compressed_path, chunk_duration_sec)
        all_segments: list[TranscriptSegment] = []

        for idx, (chunk_file, offset) in enumerate(chunk_files):
            logger.info("Sending chunk %d/%d (offset %.1fs) to Groq Whisper...", idx + 1, len(chunk_files), offset)
            chunk_segs = _transcribe_file(
                client=client,
                file_path=chunk_file,
                model=model,
                language=language,
                time_offset=offset,
            )
            all_segments.extend(chunk_segs)

            # Clean up temp chunk
            try:
                chunk_file.unlink(missing_ok=True)
            except Exception:
                pass

            if progress_callback:
                pct = int(((idx + 1) / len(chunk_files)) * 100)
                progress_callback(pct, len(all_segments))

        duration = total_duration or (all_segments[-1].end if all_segments else 0.0)
        return all_segments, round(duration, 2)

    finally:
        # Clean up compressed audio file
        try:
            compressed_path.unlink(missing_ok=True)
        except Exception:
            pass


def _transcribe_file(
    client: Any,
    file_path: Path,
    model: str,
    language: str | None,
    time_offset: float,
) -> list[TranscriptSegment]:
    """Call Groq Whisper API for a single audio file and adjust timestamps by time_offset."""
    with open(file_path, "rb") as f:
        kwargs: dict[str, Any] = {
            "file": (file_path.name, f.read()),
            "model": model,
            "response_format": "verbose_json",
            "temperature": 0.0,
        }
        if language:
            kwargs["language"] = language

        resp = client.audio.transcriptions.create(**kwargs)

    raw_segments = getattr(resp, "segments", []) or []
    segments: list[TranscriptSegment] = []

    for seg in raw_segments:
        # In verbose_json, seg can be a dict or an object
        if isinstance(seg, dict):
            start = float(seg.get("start", 0))
            end = float(seg.get("end", 0))
            text = str(seg.get("text", "")).strip()
        else:
            start = float(getattr(seg, "start", 0))
            end = float(getattr(seg, "end", 0))
            text = str(getattr(seg, "text", "")).strip()

        if text:
            segments.append(
                TranscriptSegment(
                    text=text,
                    start=round(start + time_offset, 2),
                    end=round(end + time_offset, 2),
                )
            )

    return segments


def _probe_duration(audio_path: Path) -> float:
    """Get audio duration in seconds using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ]
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode().strip()
        return float(out)
    except Exception:
        return 0.0


def _compress_audio(input_path: Path, output_path: Path) -> None:
    """Compress audio to 32kbps mono 16kHz MP3 for fast upload to Groq."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(input_path),
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "32k",
        str(output_path),
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def _split_audio(input_path: Path, chunk_duration_sec: int) -> list[tuple[Path, float]]:
    """Split audio file into chunks of chunk_duration_sec without re-encoding."""
    output_pattern = str(input_path.parent / f"{input_path.stem}_part_%03d.mp3")
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(input_path),
        "-f", "segment",
        "-segment_time", str(chunk_duration_sec),
        "-c", "copy",
        output_pattern,
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    parts: list[tuple[Path, float]] = []
    parent = input_path.parent
    prefix = f"{input_path.stem}_part_"

    for p in sorted(parent.glob(f"{prefix}*.mp3")):
        # Extract part index to compute timestamp offset
        part_str = p.stem.replace(prefix, "")
        try:
            part_idx = int(part_str)
            offset = part_idx * chunk_duration_sec
            parts.append((p, float(offset)))
        except ValueError:
            continue

    return parts
