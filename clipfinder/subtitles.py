"""YouTube subtitles extractor — downloads and parses official or auto-generated captions in seconds."""

from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any
from urllib.parse import urlparse

from clipfinder.models import TranscriptSegment

logger = logging.getLogger(__name__)

SPANISH_LANG_CODES = [
    "es",
    "es-419",
    "es-ES",
    "es-US",
    "es-MX",
    "es-AR",
    "es-CO",
    "es-PE",
    "es-CL",
]


def is_youtube_url(url: str) -> bool:
    """Check if the given string is a YouTube URL."""
    try:
        host = urlparse(url).hostname or ""
        return "youtube.com" in host or "youtu.be" in host
    except Exception:
        return False


def fetch_youtube_subtitles(
    url: str,
    language: str | None = None,
) -> tuple[list[TranscriptSegment], float] | None:
    """
    Attempt to fetch subtitles directly from YouTube without downloading audio.

    Args:
        url: YouTube video URL.
        language: Preferred language code (e.g. 'es'). If None or 'es', tries Spanish variants.

    Returns:
        tuple (segments, duration_seconds) if subtitles were found and parsed, or None.
    """
    if not is_youtube_url(url):
        return None

    import yt_dlp

    ydl_opts: Any = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return None

            duration = float(info.get("duration") or 0)
            subtitles = info.get("subtitles") or {}
            auto_captions = info.get("automatic_captions") or {}

            target_langs: list[str] = []
            if language:
                target_langs.append(language.lower())
                if language.lower().startswith("es"):
                    target_langs.extend(SPANISH_LANG_CODES)
            else:
                target_langs.extend(SPANISH_LANG_CODES)
                target_langs.append("en")

            # 1. Try manual subtitles first (human-curated)
            chosen_entries, chosen_lang = _pick_subtitle_track(subtitles, target_langs)
            # 2. Fall back to automatic captions
            if not chosen_entries:
                chosen_entries, chosen_lang = _pick_subtitle_track(auto_captions, target_langs)

            if not chosen_entries:
                logger.info("No matching subtitles found for %s in targets: %s", url, target_langs)
                return None

            segments = _parse_subtitle_entries(chosen_entries)
            if not segments:
                return None

            if duration == 0 and segments:
                duration = segments[-1].end

            logger.info(
                "Successfully fetched %d subtitle segments (lang: %s, duration: %.1fs)",
                len(segments),
                chosen_lang,
                duration,
            )
            return segments, duration

    except Exception as exc:
        logger.warning("Failed to extract YouTube subtitles: %s", exc)
        return None


def _pick_subtitle_track(
    tracks_dict: dict[str, Any],
    target_langs: list[str],
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Pick the best matching subtitle format entries and language."""
    for lang in target_langs:
        if lang in tracks_dict and tracks_dict[lang]:
            return tracks_dict[lang], lang

    # Fuzzy match on prefix (e.g. 'es' matching 'es-419')
    for lang in target_langs:
        for available_lang, formats in tracks_dict.items():
            if available_lang.startswith(lang) and formats:
                return formats, available_lang

    return None, None


def _parse_subtitle_entries(formats: list[dict[str, Any]]) -> list[TranscriptSegment] | None:
    """Download and parse subtitle track into TranscriptSegment items."""
    # Prefer json3 format (has structured millisecond timestamps)
    json3_entry = next((f for f in formats if f.get("ext") == "json3"), None)
    if json3_entry and json3_entry.get("url"):
        parsed = _parse_json3_url(json3_entry["url"])
        if parsed:
            return parsed

    # Fallback: vtt format
    vtt_entry = next((f for f in formats if f.get("ext") == "vtt"), None)
    if vtt_entry and vtt_entry.get("url"):
        parsed = _parse_vtt_url(vtt_entry["url"])
        if parsed:
            return parsed

    return None


def _parse_json3_url(url: str) -> list[TranscriptSegment] | None:
    """Fetch json3 timedtext and group into coherent sentence segments."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        events = data.get("events", [])
        raw_items: list[tuple[float, float, str]] = []

        for ev in events:
            # Skip events without start timestamp or segments
            t_start = ev.get("tStartMs")
            if t_start is None:
                continue
            d_dur = ev.get("dDurationMs") or 2000
            start_sec = round(t_start / 1000.0, 2)
            end_sec = round((t_start + d_dur) / 1000.0, 2)

            segs = ev.get("segs", [])
            text_parts = []
            for s in segs:
                t = s.get("utf8", "")
                if t and t != "\n":
                    text_parts.append(t)
            text = " ".join(text_parts).strip()
            # Clean up newlines or extra spaces
            text = " ".join(text.split())

            if text and text not in ("[Música]", "[Aplausos]", "[Risas]", "[Music]"):
                raw_items.append((start_sec, end_sec, text))

        if not raw_items:
            return None

        # Group very short fragments (< 3-5 seconds or sentence continuation)
        return _group_subtitle_items(raw_items)

    except Exception as exc:
        logger.warning("Error parsing json3 subtitles: %s", exc)
        return None


def _parse_vtt_url(url: str) -> list[TranscriptSegment] | None:
    """Fetch VTT and parse into segments."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")

        import re

        time_re = re.compile(
            r"(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})"
        )

        def to_seconds(h: str | None, m: str, s: str, ms: str) -> float:
            hours = int(h.rstrip(":")) if h else 0
            return hours * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0

        raw_items: list[tuple[float, float, str]] = []
        lines = content.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            m = time_re.search(line)
            if m:
                # Group 1-4 start, 5-8 end
                start = round(to_seconds(m.group(1), m.group(2), m.group(3), m.group(4)), 2)
                end = round(to_seconds(m.group(5), m.group(6), m.group(7), m.group(8)), 2)
                i += 1
                text_lines = []
                while i < len(lines) and lines[i].strip() and not time_re.search(lines[i]):
                    clean = re.sub(r"<[^>]+>", "", lines[i]).strip()
                    if clean:
                        text_lines.append(clean)
                    i += 1
                text = " ".join(text_lines).strip()
                if text and text not in ("[Música]", "[Aplausos]", "[Risas]", "[Music]"):
                    raw_items.append((start, end, text))
            else:
                i += 1

        if not raw_items:
            return None

        return _group_subtitle_items(raw_items)

    except Exception as exc:
        logger.warning("Error parsing VTT subtitles: %s", exc)
        return None


def _group_subtitle_items(
    items: list[tuple[float, float, str]],
    target_duration: float = 6.0,
) -> list[TranscriptSegment]:
    """
    Group small subtitle cues into coherent chunks (approx 4-8 seconds each)
    so the LLM gets complete context instead of 1-word or 1-second cues.
    """
    if not items:
        return []

    grouped: list[TranscriptSegment] = []
    curr_start, curr_end, curr_texts = items[0][0], items[0][1], [items[0][2]]

    for start, end, text in items[1:]:
        # If current chunk is long enough or there's a big pause (> 2 sec)
        pause = start - curr_end
        is_long_enough = (curr_end - curr_start) >= target_duration
        ends_sentence = curr_texts and curr_texts[-1].endswith((".", "?", "!", ":"))

        if (is_long_enough and (ends_sentence or pause > 0.8)) or pause > 2.5:
            full_text = " ".join(curr_texts).strip()
            if full_text:
                grouped.append(
                    TranscriptSegment(
                        text=full_text,
                        start=round(curr_start, 2),
                        end=round(curr_end, 2),
                    )
                )
            curr_start = start
            curr_end = end
            curr_texts = [text]
        else:
            curr_end = max(curr_end, end)
            curr_texts.append(text)

    # Flush last chunk
    if curr_texts:
        full_text = " ".join(curr_texts).strip()
        if full_text:
            grouped.append(
                TranscriptSegment(
                    text=full_text,
                    start=round(curr_start, 2),
                    end=round(curr_end, 2),
                )
            )

    return grouped
