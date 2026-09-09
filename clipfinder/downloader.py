"""Audio downloader — wraps yt-dlp to fetch audio from YouTube or local files."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


def is_url(source: str) -> bool:
    """Return True if the source string looks like a URL."""
    try:
        result = urlparse(source)
        return bool(result.scheme in ("http", "https") and result.netloc)
    except ValueError:
        return False


def get_source_id(source: str) -> str:
    """Return a clean, filesystem-safe identifier for this source."""
    if is_url(source):
        return _extract_video_id(source)
    return Path(source).stem[:60]  # cap at 60 chars for long filenames


def _extract_video_id(url: str) -> str:
    """Best-effort extraction of YouTube video ID from various URL formats."""
    parsed = urlparse(url)
    host = parsed.hostname or ""

    if "youtu.be" in host:
        return parsed.path.lstrip("/").split("?")[0] or "video"

    if "youtube.com" in host:
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            return qs.get("v", ["video"])[0]
        if parsed.path.startswith("/shorts/"):
            return parsed.path.split("/")[2]
        if parsed.path.startswith("/embed/"):
            return parsed.path.split("/")[2]

    # Fallback: use last path segment
    return parsed.path.rstrip("/").split("/")[-1] or "video"


def download_audio(
    source: str,
    output_dir: Path,
    progress_callback: Callable[[int, str], None] | None = None,
) -> tuple[Path, float]:
    """
    Download audio from a YouTube URL (or locate a local audio/video file).

    Args:
        source: YouTube URL or local file path.
        output_dir: Directory to save the audio file.
        progress_callback: Optional fn(pct: int, speed: str) called during download.

    Returns:
        (audio_path, duration_seconds)

    Note: yt-dlp requires ffmpeg installed on the system to convert to wav.
    """
    import yt_dlp  # imported here so the module can be imported without yt-dlp installed

    output_dir.mkdir(parents=True, exist_ok=True)
    audio_path = output_dir / "audio.wav"

    if is_url(source):
        def _yt_hook(d: dict[str, Any]) -> None:
            if progress_callback and d.get("status") == "downloading":
                downloaded = d.get("downloaded_bytes", 0)
                total = d.get("total_bytes") or d.get("total_bytes_estimate", 1)
                pct = int(min(99, downloaded / total * 100)) if total else 0
                speed = d.get("_speed_str", "").strip().replace("\x1b[0m", "")
                progress_callback(pct, speed)

        ydl_opts: Any = {
            "format": "bestaudio/best",
            "outtmpl": str(output_dir / "audio.%(ext)s"),
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                    "preferredquality": "0",
                }
            ],
            "postprocessor_args": {
                "FFmpegExtractAudio": ["-ar", "16000", "-ac", "1"],
            },
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [_yt_hook],
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source, download=True)
            duration: float = float(info.get("duration") or 0)

        if progress_callback:
            progress_callback(100, "")
        return audio_path, duration

    else:
        local_path = Path(source)
        if not local_path.exists():
            raise FileNotFoundError(f"File not found: {source}")

        # Try to get duration via yt-dlp (it can probe local files)
        probe_opts: Any = {"quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            try:
                info = ydl.extract_info(str(local_path), download=False)
                duration = float(info.get("duration") or 0)
            except Exception:
                duration = 0.0

        # If local file is not already wav, convert it
        if local_path.suffix.lower() != ".wav":
            _convert_to_wav(local_path, audio_path)
            return audio_path, duration

        return local_path, duration


def _convert_to_wav(input_path: Path, output_path: Path) -> None:
    """Convert any audio/video file to wav using yt-dlp's ffmpeg postprocessor."""
    import yt_dlp

    ydl_opts: Any = {
        "format": "bestaudio/best",
        "outtmpl": str(output_path.with_suffix(".%(ext)s")),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        "postprocessor_args": {
            "FFmpegExtractAudio": ["-ar", "16000", "-ac", "1"],
        },
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([str(input_path)])
