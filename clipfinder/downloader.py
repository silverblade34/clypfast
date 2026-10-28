"""Audio downloader — wraps yt-dlp to fetch audio from YouTube or local files."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)


def is_url(source: str) -> bool:
    """Return True if the source string looks like a URL."""
    try:
        result = urlparse(source)
        return bool(result.scheme in ("http", "https") and result.netloc)
    except ValueError:
        return False


def detect_platform(source: str) -> str:
    """Return 'youtube', 'twitch', 'kick', 'generic_url', or 'local'."""
    if not is_url(source):
        return "local"
    try:
        parsed = urlparse(source)
        host = (parsed.hostname or "").lower()
        if "youtube.com" in host or "youtu.be" in host:
            return "youtube"
        if "twitch.tv" in host:
            return "twitch"
        if "kick.com" in host:
            return "kick"
        return "generic_url"
    except Exception:
        return "generic_url"


def get_source_id(source: str) -> str:
    """Return a clean, filesystem-safe identifier for this source."""
    if is_url(source):
        return _extract_video_id(source)
    return Path(source).stem[:60]  # cap at 60 chars for long filenames


def _extract_video_id(url: str) -> str:
    """Best-effort extraction of video ID from YouTube, Twitch, Kick or generic URLs."""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        path = parsed.path.strip("/")
        parts = [p for p in path.split("/") if p]

        # ── YouTube ──
        if "youtu.be" in host:
            return parts[0] if parts else "yt_video"

        if "youtube.com" in host:
            if parsed.path == "/watch":
                qs = parse_qs(parsed.query)
                return qs.get("v", ["yt_video"])[0]
            if parsed.path.startswith("/shorts/") and len(parts) >= 2:
                return parts[1]
            if parsed.path.startswith("/embed/") and len(parts) >= 2:
                return parts[1]
            if parts:
                return parts[-1]

        # ── Twitch ──
        if "twitch.tv" in host:
            # Clips: clips.twitch.tv/ClipId or twitch.tv/user/clip/ClipId
            if "clips.twitch.tv" in host and parts:
                return f"twitch_clip_{parts[0]}"
            if len(parts) >= 3 and parts[1] == "clip":
                return f"twitch_clip_{parts[2]}"
            # VODs: twitch.tv/videos/123456789
            if len(parts) >= 2 and parts[0] == "videos":
                return f"twitch_{parts[1]}"
            # Live / Channel: twitch.tv/streamer
            if parts:
                return f"twitch_{parts[0]}"

        # ── Kick ──
        if "kick.com" in host:
            # Clips: kick.com/streamer?clip=clip_01HQ...
            qs = parse_qs(parsed.query)
            if "clip" in qs and qs["clip"]:
                return f"kick_clip_{qs['clip'][0]}"
            # VODs: kick.com/video/uuid or kick.com/streamer/videos/uuid
            if len(parts) >= 2 and parts[0] == "video":
                return f"kick_{parts[1]}"
            if len(parts) >= 3 and parts[1] == "videos":
                return f"kick_{parts[2]}"
            if parts:
                return f"kick_{parts[0]}"

        # ── Fallback ──
        if parts:
            safe_part = "".join(c for c in parts[-1] if c.isalnum() or c in ("-", "_"))
            if safe_part:
                return safe_part[:50]
    except Exception:
        pass

    return "video"


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


def extract_media_metadata(source: str) -> dict[str, Any]:
    """
    Extract metadata (title, channel, duration, thumbnail, platform) without downloading media.
    Works for YouTube, Twitch, Kick URLs and local file paths.
    """
    import yt_dlp

    platform = detect_platform(source)

    if is_url(source):
        opts: Any = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(source, download=False)
                if info:
                    channel = (
                        info.get("channel")
                        or info.get("uploader")
                        or info.get("uploader_id")
                    )
                    title = info.get("title")
                    duration = float(info.get("duration") or 0)
                    thumbnail = info.get("thumbnail")
                    return {
                        "title": title,
                        "channel": channel,
                        "duration": duration,
                        "thumbnail": thumbnail,
                        "platform": platform,
                    }
        except Exception as exc:
            logger.warning("Failed to extract metadata for %s: %s", source, exc)
    else:
        p = Path(source)
        return {
            "title": p.stem,
            "channel": None,
            "duration": 0.0,
            "thumbnail": None,
            "platform": platform,
        }

    return {"title": None, "channel": None, "duration": 0.0, "thumbnail": None, "platform": platform}

