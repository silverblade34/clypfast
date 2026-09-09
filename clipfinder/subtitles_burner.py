"""Subtitles generator and video burning engine for ClipFinder.

Generates dynamic .ass (Advanced SubStation Alpha) subtitles with:
- Hook Title overlay (first 0-3.5s) in top third of video.
- Word-by-word active highlight (Hormozi Pop, Minimal Clean, Cyberpunk).
- Audio loudness normalization via ffmpeg loudnorm.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from clipfinder.models import TranscriptSegment

logger = logging.getLogger(__name__)


def _fmt_ass_time(seconds: float) -> str:
    """Format seconds into ASS subtitle time: H:MM:SS.cc"""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


THEMES: dict[str, dict[str, Any]] = {
    "hormozi": {
        "name": "Hormozi Pop",
        "font": "Arial Black",
        "size": 44,
        "base_color": "&H00FFFFFF&",       # White
        "highlight_color": "&H0000FFFF&",  # Yellow Neon (BGR format in ASS: 00FFFF = Yellow)
        "outline_color": "&H00000000&",    # Deep Black
        "outline": 5,
        "shadow": 2,
        "uppercase": True,
        "margin_v": 380,                   # Above TikTok bottom UI zone
    },
    "minimal": {
        "name": "Minimal Clean",
        "font": "Helvetica",
        "size": 38,
        "base_color": "&H00FFFFFF&",       # White
        "highlight_color": "&H00FFFF22&",  # Cyan accent
        "outline_color": "&H00141414&",    # Subtle dark outline
        "outline": 3,
        "shadow": 1,
        "uppercase": False,
        "margin_v": 380,
    },
    "cyberpunk": {
        "name": "Cyberpunk",
        "font": "Impact",
        "size": 46,
        "base_color": "&H00FFFF00&",       # Cyan
        "highlight_color": "&H00FF00FF&",  # Magenta / Hot Pink
        "outline_color": "&H00200020&",    # Dark Purple
        "outline": 5,
        "shadow": 3,
        "uppercase": True,
        "margin_v": 380,
    },
}


def extract_words_for_clip(
    segments: list[TranscriptSegment] | list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
) -> list[dict[str, Any]]:
    """
    Extract word-level timestamps relative to clip_start (0.0 to clip_duration).
    If word timestamps are not present, synthesizes word timings from segment text.
    """
    clip_words: list[dict[str, Any]] = []

    for seg in segments:
        if isinstance(seg, dict):
            s_start = float(seg.get("start", 0.0))
            s_end = float(seg.get("end", 0.0))
            s_text = str(seg.get("text", "")).strip()
            words_data = seg.get("words")
        else:
            s_start = float(seg.start)
            s_end = float(seg.end)
            s_text = str(seg.text).strip()
            words_data = seg.words

        # Check if segment overlaps with clip
        if s_end < clip_start or s_start > clip_end:
            continue

        if words_data and len(words_data) > 0:
            for w in words_data:
                w_start = float(w.get("start", s_start))
                w_end = float(w.get("end", s_end))
                w_text = str(w.get("word", "")).strip()
                if not w_text:
                    continue
                if w_end >= clip_start and w_start <= clip_end:
                    rel_start = max(0.0, w_start - clip_start)
                    rel_end = max(rel_start + 0.1, w_end - clip_start)
                    clip_words.append({
                        "word": w_text,
                        "start": rel_start,
                        "end": rel_end,
                    })
        else:
            # Synthesize word timestamps by distributing duration evenly based on word lengths
            words_in_text = s_text.split()
            if not words_in_text:
                continue

            seg_start_rel = max(0.0, s_start - clip_start)
            seg_end_rel = max(seg_start_rel + 0.3, s_end - clip_start)
            seg_dur = max(0.3, seg_end_rel - seg_start_rel)

            total_chars = sum(len(w) for w in words_in_text)
            curr_t = seg_start_rel

            for w in words_in_text:
                w_len = len(w)
                w_fraction = (w_len / total_chars) if total_chars > 0 else (1 / len(words_in_text))
                w_dur = max(0.15, seg_dur * w_fraction)
                clip_words.append({
                    "word": w,
                    "start": curr_t,
                    "end": curr_t + w_dur,
                })
                curr_t += w_dur

    return clip_words


def generate_ass_subtitles(
    clip_title: str | None,
    words: list[dict[str, Any]],
    output_ass_path: Path,
    theme: str = "hormozi",
    include_hook_title: bool = True,
    target_w: int = 1080,
    target_h: int = 1920,
    # --- Personalización dinámica desde el modal (overrides sobre el tema base) ---
    hook_title_custom: str | None = None,
    hook_duration: float | None = None,
    sub_font: str | None = None,
    sub_base_color: str | None = None,
    sub_highlight_color: str | None = None,
    sub_margin_v: int | None = None,
) -> Path:
    """
    Generate an ASS subtitle file formatted with Hook Title and active word highlights.

    Personalización dinámica:
    - hook_title_custom: sobreescribe el texto del gancho (por defecto usa clip_title).
    - hook_duration: duración en pantalla del gancho en segundos (default: 3.5s).
    - sub_font: sobreescribe la fuente del tema base.
    - sub_base_color: color principal del texto en formato ASS (&H00BBGGRR&).
    - sub_highlight_color: color de la palabra resaltada en formato ASS.
    - sub_margin_v: margen vertical en píxeles (sobre 1920px) desde el fondo.
    """
    output_ass_path.parent.mkdir(parents=True, exist_ok=True)
    cfg = THEMES.get(theme, THEMES["hormozi"])

    # Aplicar overrides del modal: si se pasa un valor, tiene precedencia sobre el tema
    font_name = sub_font if sub_font else cfg["font"]
    font_size = cfg["size"]
    base_col = sub_base_color if sub_base_color else cfg["base_color"]
    hl_col = sub_highlight_color if sub_highlight_color else cfg["highlight_color"]
    out_col = cfg["outline_color"]
    outline = cfg["outline"]
    shadow = cfg["shadow"]
    margin_v = sub_margin_v if sub_margin_v is not None else cfg["margin_v"]
    to_upper = cfg["uppercase"]

    # Texto del gancho: texto personalizado tiene precedencia sobre el título del clip
    effective_hook_title = hook_title_custom if hook_title_custom else clip_title
    # Duración del gancho: override o default de 3.5s
    effective_hook_duration = hook_duration if hook_duration is not None else 3.5

    ass_lines: list[str] = [
        "[Script Info]",
        "Title: ClipFinder Generated Subtitles",
        "ScriptType: v4.00+",
        f"PlayResX: {target_w}",
        f"PlayResY: {target_h}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # Hook Title Style: Large, Top-centered, upper third (MarginV=260)
        f"Style: HookTitle,Arial Black,48,&H00FFFFFF&,&H000000FF&,&H00000000&,&H80000000&,1,0,0,0,100,100,0,0,1,5,3,8,50,50,260,1",
        # Subtitle Base Style: Center-bottom, above safe zone
        f"Style: DynamicSub,{font_name},{font_size},{base_col},&H000000FF&,{out_col},&H80000000&,1,0,0,0,100,100,1,0,1,{outline},{shadow},2,50,50,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    # 1. Hook Title (0.0s a effective_hook_duration)
    if include_hook_title and effective_hook_title:
        title_text = effective_hook_title.strip().upper()
        # Salto de línea DETERMINISTA: si excede 35 chars, partimos manualmente con \N
        # Esto garantiza que el corte de línea sea idéntico entre el modal (CSS <br/>) y ffmpeg (\N en ASS)
        if len(title_text) > 35:
            words_title = title_text.split()
            mid = len(words_title) // 2
            # Aseguramos que la primera línea no exceda 35 chars; ajustamos mid si es necesario
            while mid > 1 and len(" ".join(words_title[:mid])) > 35:
                mid -= 1
            title_text = " ".join(words_title[:mid]) + "\\N" + " ".join(words_title[mid:])

        hook_end_fmt = _fmt_ass_time(effective_hook_duration)
        ass_lines.append(
            f"Dialogue: 1,0:00:00.00,{hook_end_fmt},HookTitle,,0,0,0,,{{\\fad(200,250)}}"
            f"{{\\c&H0000FFFF&}}★ {{\\c&H00FFFFFF&}}{title_text}{{\\c&H0000FFFF&}} ★"
        )

    # 2. Dynamic Word-by-Word Highlight Subtitles
    # Group words into short chunks of 2 to 4 words
    chunk_size = 3
    for i in range(0, len(words), chunk_size):
        chunk = words[i : i + chunk_size]
        if not chunk:
            continue

        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]

        # For each word in this chunk, create a sub-event where that specific word is highlighted
        for w_idx, active_word in enumerate(chunk):
            w_start = active_word["start"]
            # Word sub-interval: lasts until next word starts or until chunk ends
            if w_idx < len(chunk) - 1:
                w_end = chunk[w_idx + 1]["start"]
            else:
                w_end = chunk_end

            if w_end <= w_start:
                w_end = w_start + 0.2

            # Build line text: highlight the active word
            formatted_words: list[str] = []
            for j, w in enumerate(chunk):
                raw_w = w["word"]
                display_w = raw_w.upper() if to_upper else raw_w
                if j == w_idx:
                    formatted_words.append(f"{{\\c{hl_col}}}{display_w}{{\\c{base_col}}}")
                else:
                    formatted_words.append(display_w)

            line_text = " ".join(formatted_words)
            start_fmt = _fmt_ass_time(w_start)
            end_fmt = _fmt_ass_time(w_end)

            ass_lines.append(f"Dialogue: 0,{start_fmt},{end_fmt},DynamicSub,,0,0,0,,{line_text}")

    output_ass_path.write_text("\n".join(ass_lines), encoding="utf-8")
    return output_ass_path
