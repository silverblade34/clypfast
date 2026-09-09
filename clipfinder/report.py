"""Report generator — saves analysis results as JSON, Markdown, and CSV."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from clipfinder.models import AnalysisResult, TranscriptSegment


def _fmt(seconds: float) -> str:
    """Format seconds as MM:SS or HH:MM:SS."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _fmt_duration(seconds: float) -> str:
    """Format seconds as a human-readable duration string."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}m {s:02d}s"


# ── Individual savers ─────────────────────────────────────────────────────────


def save_json(result: AnalysisResult, output_dir: Path) -> Path:
    """Save full analysis result as structured JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "clips.json"
    path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    return path


def save_transcript(segments: list[TranscriptSegment], output_dir: Path) -> Path:
    """Save raw Whisper transcript as JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "transcript.json"
    data = [seg.model_dump() for seg in segments]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def save_markdown(result: AnalysisResult, output_dir: Path) -> Path:
    """Save a human-readable Markdown report for editors."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "report.md"

    lines: list[str] = [
        "# 🎬 ClipFinder — Reporte de Momentos Virales",
        "",
        "## Información del Video",
        "",
        f"| Campo | Valor |",
        f"|-------|-------|",
        f"| 🔗 Fuente | `{result.video_source}` |",
        f"| ⏱️ Duración | {_fmt_duration(result.duration_seconds)} |",
        f"| 📝 Segmentos transcritos | {result.transcript_segments} |",
        f"| 🧠 Modelo LLM | `{result.llm_model}` |",
        f"| 🎙️ Modelo Whisper | `{result.whisper_model}` |",
        f"| 🎯 Clips detectados | **{len(result.clips)}** |",
        "",
        "---",
        "",
        "## 🎯 Clips Candidatos",
        "",
        "> Ordenados por potencial viral (score 10 = máximo viral).",
        "",
    ]

    for i, clip in enumerate(result.clips, 1):
        duration_s = int(clip.end_seconds - clip.start_seconds)
        stars = "⭐" * clip.score + "☆" * (10 - clip.score)
        lines += [
            f"### {i}. {clip.title}",
            "",
            f"| | |",
            f"|-|-|",
            f"| **⏱️ Inicio** | `{_fmt(clip.start_seconds)}` ({int(clip.start_seconds)}s) |",
            f"| **⏱️ Fin** | `{_fmt(clip.end_seconds)}` ({int(clip.end_seconds)}s) |",
            f"| **⏳ Duración** | {duration_s}s |",
            f"| **🔥 Score** | {clip.score}/10 — {stars} |",
            f"| **💡 Motivo** | {clip.reason} |",
            "",
            "---" if i < len(result.clips) else "",
            "",
        ]

    lines += [
        "## 📋 Cómo usar este reporte",
        "",
        "1. Abre tu editor de video (CapCut / Premiere / DaVinci Resolve)",
        "2. Busca el timestamp de **Inicio** del clip",
        "3. Corta desde ahí hasta el timestamp de **Fin**",
        "4. El **Score** indica prioridad — empieza por los clips con score ≥ 8",
        "5. Revisa el **Motivo** para contextualizar el clip antes de editarlo",
        "",
        "_Generado por ClipFinder v0.1.0_",
    ]

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def save_csv(result: AnalysisResult, output_dir: Path) -> Path:
    """Save clips as a CSV importable in spreadsheets."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "clips.csv"

    fieldnames = [
        "rank",
        "title",
        "start",
        "end",
        "start_seconds",
        "end_seconds",
        "duration_seconds",
        "score",
        "reason",
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, clip in enumerate(result.clips, 1):
            writer.writerow(
                {
                    "rank": i,
                    "title": clip.title,
                    "start": _fmt(clip.start_seconds),
                    "end": _fmt(clip.end_seconds),
                    "start_seconds": clip.start_seconds,
                    "end_seconds": clip.end_seconds,
                    "duration_seconds": int(clip.end_seconds - clip.start_seconds),
                    "score": clip.score,
                    "reason": clip.reason,
                }
            )

    return path


# ── Master saver ──────────────────────────────────────────────────────────────


def save_all(
    result: AnalysisResult,
    segments: list[TranscriptSegment],
    output_dir: Path,
) -> dict[str, Path]:
    """
    Save all report formats and the raw transcript.

    Returns:
        Dict mapping format name to saved file path.
    """
    return {
        "json": save_json(result, output_dir),
        "markdown": save_markdown(result, output_dir),
        "csv": save_csv(result, output_dir),
        "transcript": save_transcript(segments, output_dir),
    }
