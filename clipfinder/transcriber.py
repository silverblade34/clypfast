"""Transcriber — wraps faster-whisper for local audio transcription with timestamps."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Literal

from clipfinder.models import TranscriptSegment

WhisperModelSize = Literal["tiny", "base", "small", "medium", "large-v2", "large-v3"]

# Recommended defaults per hardware tier
DEVICE_COMPUTE_DEFAULTS: dict[str, tuple[str, str]] = {
    "cuda": ("cuda", "float16"),
    "mps": ("cpu", "int8"),   # MPS (Apple Silicon) not well-supported in CTranslate2; fall back to CPU
    "cpu": ("cpu", "int8"),
}


def detect_device() -> str:
    """Detect the best available compute device."""
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def transcribe(
    audio_path: Path,
    model_size: WhisperModelSize = "small",
    language: str | None = None,
    device: str = "auto",
    compute_type: str = "auto",
    vad_filter: bool = True,
    beam_size: int = 1,
    cpu_threads: int = 8,
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[list[TranscriptSegment], float]:
    """
    Transcribe an audio file using faster-whisper optimized for Apple Silicon CPU.

    Args:
        audio_path: Path to the audio file (wav, mp3, etc.)
        model_size: Whisper model size. 'small' is a good default for CPU.
        language: ISO 639-1 language code (e.g. 'es', 'en'). None = auto-detect.
        device: 'auto', 'cpu', or 'cuda'.
        compute_type: 'auto', 'int8', 'float16', 'float32'.
        vad_filter: Apply voice activity detection to filter silence.
        beam_size: 1 = greedy decoding (3x-4x faster, optimal for CPU with negligible WER loss).
        cpu_threads: Number of CPU threads (default 8 for M3 Pro performance cores).
        progress_callback: Optional fn(pct: int, n_segments: int) called per segment.

    Returns:
        (segments, audio_duration_seconds)
    """
    from faster_whisper import WhisperModel

    # Resolve device and compute type
    if device == "auto":
        device = detect_device()
        if device == "mps":
            device = "cpu"  # CTranslate2 doesn't support MPS natively

    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
        download_root=None,  # uses HuggingFace cache (~/.cache/huggingface)
    )

    segments_gen, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=beam_size,
        best_of=1,
        temperature=0.0,
        vad_filter=vad_filter,
        vad_parameters={
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 200,
        },
        word_timestamps=False,
        condition_on_previous_text=False,
    )

    total_duration = info.duration or 1.0  # avoid div-by-zero
    segments: list[TranscriptSegment] = []

    for seg in segments_gen:
        text = seg.text.strip()
        if not text:
            continue
        segments.append(
            TranscriptSegment(
                text=text,
                start=round(seg.start, 2),
                end=round(seg.end, 2),
            )
        )
        if progress_callback:
            pct = int(min(99, seg.end / total_duration * 100))
            progress_callback(pct, len(segments))

    if progress_callback:
        progress_callback(100, len(segments))

    duration = round(info.duration, 2) if info.duration else _estimate_duration(segments)
    return segments, duration


def _estimate_duration(segments: list[TranscriptSegment]) -> float:
    """Estimate total duration from segment end times."""
    if not segments:
        return 0.0
    return segments[-1].end
