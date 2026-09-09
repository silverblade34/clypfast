"""FastAPI backend for ClipFinder web interface.

Runs the clipfinder pipeline in background threads and exposes
polling endpoints for the Next.js frontend.

Usage:
    uvicorn api:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="ClipFinder API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    from clipfinder.db import init_db
    init_db()

# ── In-memory job store ────────────────────────────────────────────────────────
# Fine for single-user MVP; replace with Redis/DB for multi-user.
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _update_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        _jobs[job_id].update(kwargs)


def _get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        return dict(_jobs.get(job_id, {}))


# ── Request / Response schemas ─────────────────────────────────────────────────


class AnalyzeRequest(BaseModel):
    url: str
    transcription_engine: Literal["auto", "groq", "local", "youtube_subs"] = "auto"
    whisper_model: str = "small"
    max_clips: int = 12
    language: str | None = None
    provider: str = "groq"
    cliente: str | None = None
    content_type: str = "general"


# ── Pipeline runner (runs in background thread) ────────────────────────────────


def _run_pipeline(job_id: str, req: AnalyzeRequest) -> None:
    """Run the full ClipFinder pipeline and update job progress."""
    try:
        from clipfinder.downloader import download_audio, extract_media_metadata, get_source_id, is_url
        from clipfinder.subtitles import fetch_youtube_subtitles
        from clipfinder.groq_whisper import transcribe_with_groq
        from clipfinder.transcriber import transcribe
        from clipfinder.analyzer import GEMINI_MODELS, GROQ_MODELS, analyze_segments, chunk_segments
        from clipfinder.models import AnalysisResult
        from clipfinder.report import save_all

        # Resolve API key for LLM analysis
        env_key = "GROQ_API_KEY" if req.provider == "groq" else "GEMINI_API_KEY"
        api_key = os.getenv(env_key)
        if not api_key:
            _update_job(job_id, status="error", error=f"Missing {env_key} in .env")
            return

        groq_key = os.getenv("GROQ_API_KEY")

        video_id = get_source_id(req.url)
        output_dir = Path("outputs") / video_id
        duration = 0.0
        segments = []
        method_used = None
        audio_path: Path | None = None
        video_title: str = f"Video {video_id}"
        video_channel: str | None = None

        # Extract real title and channel early
        try:
            meta = extract_media_metadata(req.url)
            if meta.get("title"):
                video_title = meta["title"]
            if meta.get("channel"):
                video_channel = meta["channel"]
            if duration == 0 and meta.get("duration"):
                duration = meta["duration"]
        except Exception as meta_exc:
            logger.warning("Failed to extract early video metadata: %s", meta_exc)

        _update_job(
            job_id,
            video_title=video_title,
            video_channel=video_channel,
        )

        # ── Step 0: Try Instant YouTube Subtitles ────────────────────────────
        if req.transcription_engine in ("auto", "youtube_subs") and is_url(req.url):
            _update_job(
                job_id,
                step="subtitles",
                step_label="Buscando subtítulos de YouTube en español...",
                progress=10,
                video_id=video_id,
            )
            subs_data = fetch_youtube_subtitles(req.url, language=req.language)
            if subs_data:
                segments, duration = subs_data
                method_used = "youtube_subs"
                transcript_preview = [
                    {
                        "time": f"{int(s.start // 60):02d}:{int(s.start % 60):02d}",
                        "text": s.text.strip(),
                    }
                    for s in segments[:35]
                ]
                _update_job(
                    job_id,
                    step="transcribe_done",
                    step_label=f"✓ Subtítulos oficiales de YouTube obtenidos ({len(segments)} segmentos)",
                    progress=60,
                    segments=len(segments),
                    duration=round(duration, 1),
                    transcription_method_used="youtube_subs",
                    transcript_preview=transcript_preview,
                )
            elif req.transcription_engine == "youtube_subs":
                _update_job(
                    job_id,
                    status="error",
                    step="error",
                    step_label="Subtítulos no disponibles",
                    error="No se encontraron subtítulos en español para este video en YouTube. Por favor selecciona 'Auto', 'Groq Whisper' o 'Local'.",
                )
                return

        # ── Step 1 & 2: Download + Whisper (Groq or Local) if no subtitles ────
        if not segments:
            # ── Step 1: Download audio ────────────────────────────────────────
            _update_job(
                job_id,
                step="download",
                step_label="Descargando audio (16kHz mono)...",
                progress=15,
                video_id=video_id,
                download_pct=0,
            )

            def on_download(pct: int, speed: str) -> None:
                _update_job(
                    job_id,
                    download_pct=pct,
                    download_speed=speed,
                    progress=15 + int(pct * 0.15),
                )

            audio_path, duration = download_audio(req.url, output_dir, progress_callback=on_download)

            _update_job(
                job_id,
                step="download_done",
                progress=30,
                duration=round(duration, 1),
            )

            # ── Step 2: Transcribe ────────────────────────────────────────────
            def on_transcribe(pct: int, n_segs: int) -> None:
                _update_job(
                    job_id,
                    step="transcribe",
                    transcribe_pct=pct,
                    transcribe_segs=n_segs,
                    progress=35 + int(pct * 0.25),
                )

            use_groq_whisper = (
                (req.transcription_engine == "groq")
                or (req.transcription_engine == "auto" and bool(groq_key))
            )

            if use_groq_whisper:
                _update_job(
                    job_id,
                    step="transcribe",
                    step_label="Transcribiendo con Groq Whisper Cloud (Large-v3-Turbo)...",
                    progress=35,
                    transcribe_pct=10,
                    transcribe_segs=0,
                )
                segments, audio_dur = transcribe_with_groq(
                    audio_path,
                    api_key=groq_key,
                    language=req.language or "es",
                    model="whisper-large-v3-turbo",
                    progress_callback=on_transcribe,
                )
                method_used = "groq"
                if duration == 0:
                    duration = audio_dur
            else:
                _update_job(
                    job_id,
                    step="transcribe",
                    step_label=f"Transcribiendo con Whisper local M3 Pro ({req.whisper_model})...",
                    progress=35,
                    transcribe_pct=0,
                    transcribe_segs=0,
                )
                segments, audio_dur = transcribe(
                    audio_path,
                    model_size=req.whisper_model,  # type: ignore[arg-type]
                    language=req.language,
                    beam_size=1,
                    cpu_threads=8,
                    progress_callback=on_transcribe,
                )
                method_used = "local"
                if duration == 0:
                    duration = audio_dur

            transcript_preview = [
                {
                    "time": f"{int(s.start // 60):02d}:{int(s.start % 60):02d}",
                    "text": s.text.strip(),
                }
                for s in segments[:35]
            ]

            _update_job(
                job_id,
                step="transcribe_done",
                progress=62,
                segments=len(segments),
                duration=round(duration, 1),
                transcription_method_used=method_used,
                transcript_preview=transcript_preview,
            )

        # ── Step 3: LLM analysis ─────────────────────────────────────────────
        model_name = (
            GROQ_MODELS["default"] if req.provider == "groq" else GEMINI_MODELS["default"]
        )

        analysis_chunks = chunk_segments(segments)
        initial_chunk_range = (
            f"00:00 - {int(min(duration, 300) // 60):02d}:{int(min(duration, 300) % 60):02d}"
            if duration > 0 else "00:00 - 05:00"
        )

        _update_job(
            job_id,
            step="analyze",
            step_label=f"Analizando con {req.provider.upper()} ({model_name} • {req.content_type})...",
            progress=65,
            chunk_current=1,
            chunk_total=len(analysis_chunks),
            chunk_time_range=initial_chunk_range,
            clips_found_so_far=0,
            live_clips=[],
        )

        def on_chunk(
            current: int,
            total: int,
            err: str | None = None,
            chunk_info: dict[str, Any] | None = None,
        ) -> None:
            pct = 65 + int((current / total) * 25) if total else 65
            updates: dict[str, Any] = {
                "progress": pct,
                "chunk_current": current,
                "chunk_total": total,
            }
            if chunk_info:
                updates["chunk_time_range"] = chunk_info.get("chunk_time_range", "")
                updates["clips_found_so_far"] = chunk_info.get("clips_found_so_far", 0)
                updates["live_clips"] = chunk_info.get("latest_clips", [])
                time_r = chunk_info.get("chunk_time_range", "")
                n_clips = chunk_info.get("clips_found_so_far", 0)
                updates["step_label"] = (
                    f"Analizando bloque {current}/{total} ({time_r}) • {n_clips} clips detectados..."
                )
            _update_job(job_id, **updates)

        clips = analyze_segments(
            segments=segments,
            provider=req.provider,  # type: ignore[arg-type]
            api_key=api_key,
            model=model_name,
            max_clips=req.max_clips,
            content_type=req.content_type,
            progress_callback=on_chunk,
        )

        _update_job(
            job_id,
            step="analyze_done",
            progress=90,
            clips_found_so_far=len(clips),
            live_clips=[
                {
                    "title": c.title,
                    "score": c.score,
                    "start_seconds": c.start_seconds,
                    "end_seconds": c.end_seconds,
                    "reason": c.reason,
                }
                for c in clips
            ],
        )

        # ── Step 4: Save reports ─────────────────────────────────────────────
        _update_job(job_id, step="saving", step_label="Guardando reportes...", progress=92)

        whisper_model_label = (
            "YouTube Subtitles" if method_used == "youtube_subs"
            else "Groq Whisper Large-v3" if method_used == "groq"
            else f"Whisper {req.whisper_model} (M3 Pro)"
        )

        result = AnalysisResult(
            video_source=req.url,
            duration_seconds=duration,
            clips=clips,
            transcript_segments=len(segments),
            llm_model=model_name,
            whisper_model=whisper_model_label,
            cliente=req.cliente,
        )
        save_all(result, segments, output_dir)

        # ── Persist in SQLite Database (Agency phase) ─────────────────────────
        db_video_id: int | None = None
        clips_data: list[dict[str, Any]] = []
        try:
            from sqlmodel import Session
            from clipfinder.db import engine
            from clipfinder.models import Video, Clip, ClipStatus

            with Session(engine) as db_session:
                db_vid = Video(
                    source_url=req.url if is_url(req.url) else None,
                    source_path=req.url if not is_url(req.url) else None,
                    cliente=req.cliente,
                    channel=video_channel,
                    title=video_title,
                    duration_seconds=duration,
                    provider=req.provider,
                    llm_model=model_name,
                )
                db_session.add(db_vid)
                db_session.commit()
                db_session.refresh(db_vid)
                db_video_id = db_vid.id

                for cand in clips:
                    db_clip = Clip(
                        video_id=db_vid.id,  # type: ignore[arg-type]
                        start_seconds=cand.start_seconds,
                        end_seconds=cand.end_seconds,
                        title=cand.title,
                        reason=cand.reason,
                        score=cand.score,
                        status=ClipStatus.prospecto,
                        caption=cand.caption,
                        hashtags=cand.hashtags_str if hasattr(cand, "hashtags_str") else str(cand.hashtags or ""),
                    )
                    db_session.add(db_clip)
                    db_session.commit()
                    db_session.refresh(db_clip)

                    cand_dict = cand.model_dump()
                    cand_dict["id"] = db_clip.id
                    cand_dict["status"] = db_clip.status.value
                    clips_data.append(cand_dict)
        except Exception as db_err:
            logger.warning("Error persisting to database: %s", db_err)
            clips_data = [c.model_dump() for c in clips]

        # Clean up audio for YouTube downloads
        if audio_path and is_url(req.url) and audio_path.exists() and audio_path.name == "audio.wav":
            audio_path.unlink(missing_ok=True)

        res_dict = result.model_dump()
        res_dict["clips"] = clips_data
        res_dict["video_db_id"] = db_video_id
        res_dict["video_title"] = video_title
        res_dict["video_channel"] = video_channel
        res_dict["provider"] = req.provider
        res_dict["llm_model"] = model_name

        _update_job(
            job_id,
            status="done",
            step="done",
            step_label="¡Análisis completo!",
            progress=100,
            result=res_dict,
        )

    except Exception as exc:
        _update_job(
            job_id,
            status="error",
            step="error",
            step_label="Error en el pipeline",
            error=str(exc),
            progress=0,
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────


@app.post("/analyze")
async def start_analysis(req: AnalyzeRequest) -> dict[str, str]:
    """Start the ClipFinder pipeline for the given URL. Returns a job_id to poll."""
    job_id = str(uuid.uuid4())

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "running",
            "step": "starting",
            "step_label": "Iniciando pipeline...",
            "progress": 0,
            "video_id": None,
            "duration": 0,
            "segments": 0,
            "chunk_current": 0,
            "chunk_total": 0,
            # Granular sub-progress
            "download_pct": 0,
            "download_speed": "",
            "transcribe_pct": 0,
            "transcribe_segs": 0,
            "transcription_engine": req.transcription_engine,
            "transcription_method_used": None,
            "result": None,
            "error": None,
            "url": req.url,
        }

    thread = threading.Thread(
        target=_run_pipeline,
        args=(job_id, req),
        daemon=True,
        name=f"clipfinder-{job_id[:8]}",
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    """Poll this endpoint to get the current status and result of a job."""
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


# ── Render Clip Job Store & Endpoints ──────────────────────────────────────────

CLIPS_OUTPUT_DIR = Path("outputs") / "clips"
_render_jobs: dict[str, dict[str, Any]] = {}
_render_jobs_lock = threading.Lock()


def _update_render_job(render_id: str, **kwargs: Any) -> None:
    with _render_jobs_lock:
        if render_id in _render_jobs:
            _render_jobs[render_id].update(kwargs)


def _get_render_job(render_id: str) -> dict[str, Any] | None:
    with _render_jobs_lock:
        job = _render_jobs.get(render_id)
        return dict(job) if job else None


class RenderClipRequest(BaseModel):
    url: str
    clip_index: int
    start_seconds: float
    end_seconds: float
    title: str = "clip"
    mode: Literal["smart_vertical", "vertical_blur", "original", "split_screen", "smart_track"] = "smart_vertical"
    subtitle_theme: Literal["hormozi", "minimal", "cyberpunk", "none"] = "hormozi"
    include_hook_title: bool = True
    normalize_audio: bool = True
    clip_id: int | None = None
    # --- Personalización del modal (Fase 2) ---
    hook_title_custom: str | None = None        # Texto personalizado del gancho (sobreescribe el título IA)
    hook_duration: float | None = None          # Duración en pantalla del gancho (seg, ej: 3.5)
    sub_font: str | None = None                 # Fuente de subtítulos (debe existir en el sistema / fontsdir)
    sub_base_color: str | None = None           # Color base en formato ASS: &H00BBGGRR&
    sub_highlight_color: str | None = None      # Color de palabra activa en formato ASS
    sub_margin_v: int | None = None             # Margen vertical desde el fondo (píxeles sobre 1920px)


def _run_render_job(render_id: str, req: RenderClipRequest) -> None:
    try:
        import json
        from clipfinder.downloader import get_source_id
        from clipfinder.video_cropper import process_clip
        from clipfinder.subtitles_burner import extract_words_for_clip

        CLIPS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        safe_title = "".join(c for c in req.title if c.isalnum() or c in (" ", "_", "-")).strip()[:35].replace(" ", "_")
        if not safe_title:
            safe_title = f"clip_{req.clip_index + 1}"
        theme_tag = f"_{req.subtitle_theme}" if req.subtitle_theme != "none" else ""
        filename = f"clip_{req.clip_index + 1}_{safe_title}_{req.mode}{theme_tag}_{render_id[:6]}.mp4"
        final_path = CLIPS_OUTPUT_DIR / filename

        def on_progress(pct: int, label: str) -> None:
            _update_render_job(
                render_id,
                progress=pct,
                step_label=label,
            )

        # Try to load word timestamps for this clip
        words_data: list[dict[str, Any]] | None = None
        video_id = get_source_id(req.url)
        transcript_file = Path("outputs") / video_id / "transcript.json"
        if transcript_file.exists():
            try:
                raw_segs = json.loads(transcript_file.read_text(encoding="utf-8"))
                words_data = extract_words_for_clip(raw_segs, req.start_seconds, req.end_seconds)
            except Exception as tr_err:
                logger.warning("Could not parse transcript for subtitles: %s", tr_err)

        process_clip(
            source=req.url,
            start_sec=req.start_seconds,
            end_sec=req.end_seconds,
            output_path=final_path,
            mode=req.mode,
            subtitle_theme=req.subtitle_theme,
            include_hook_title=req.include_hook_title,
            normalize_audio=req.normalize_audio,
            clip_title=req.title,
            words_data=words_data,
            progress_callback=on_progress,
            # Propagación de overrides del modal (Fase 2)
            hook_title_custom=req.hook_title_custom,
            hook_duration=req.hook_duration,
            sub_font=req.sub_font,
            sub_base_color=req.sub_base_color,
            sub_highlight_color=req.sub_highlight_color,
            sub_margin_v=req.sub_margin_v,
        )

        # Update status in SQLite database if clip_id was provided
        if req.clip_id:
            try:
                from datetime import datetime, timezone
                from sqlmodel import Session
                from clipfinder.db import engine
                from clipfinder.models import Clip, ClipStatus

                with Session(engine) as db_session:
                    db_clip = db_session.get(Clip, req.clip_id)
                    if db_clip:
                        db_clip.output_path = str(final_path)
                        db_clip.status = (
                            ClipStatus.subtitulado if req.subtitle_theme != "none" else ClipStatus.enfoque_generado
                        )
                        db_clip.updated_at = datetime.now(timezone.utc)
                        db_session.add(db_clip)
                        db_session.commit()
            except Exception as db_err:
                logger.warning("Error updating clip record in DB: %s", db_err)

        _update_render_job(
            render_id,
            status="done",
            progress=100,
            step_label="¡Clip listo para descargar!",
            filename=filename,
            download_url=f"/clips/download/{filename}",
        )
    except Exception as exc:
        _update_render_job(
            render_id,
            status="error",
            progress=0,
            step_label="Error al procesar el video",
            error=str(exc),
        )


@app.post("/clips/render")
async def start_render_clip(req: RenderClipRequest) -> dict[str, str]:
    """Trigger clipping and processing in background."""
    render_id = str(uuid.uuid4())

    with _render_jobs_lock:
        _render_jobs[render_id] = {
            "status": "running",
            "progress": 5,
            "step_label": "Iniciando procesamiento...",
            "mode": req.mode,
            "title": req.title,
            "clip_index": req.clip_index,
            "filename": None,
            "download_url": None,
            "error": None,
        }

    thread = threading.Thread(
        target=_run_render_job,
        args=(render_id, req),
        daemon=True,
        name=f"render-{render_id[:8]}",
    )
    thread.start()

    return {"render_id": render_id}


@app.get("/clips/render-status/{render_id}")
async def get_render_status(render_id: str) -> dict[str, Any]:
    """Poll render status."""
    job = _get_render_job(render_id)
    if not job:
        raise HTTPException(status_code=404, detail="Render job not found")
    return job


@app.get("/clips/download/{filename}")
async def download_clip_file(filename: str) -> FileResponse:
    """Download the processed clip MP4 directly."""
    file_path = CLIPS_OUTPUT_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=filename,
    )


# ── Editorial & Agency REST Endpoints ──────────────────────────────────────────


@app.get("/videos")
async def list_videos() -> list[dict[str, Any]]:
    """List all historical processed videos with clip counts."""
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Video

    with Session(engine) as session:
        videos = session.exec(select(Video).order_by(col(Video.created_at).desc())).all()
        results: list[dict[str, Any]] = []
        for v in videos:
            v_dict = v.model_dump()
            v_dict["clips_count"] = len(v.clips)
            v_dict["status_summary"] = {
                "prospecto": sum(1 for c in v.clips if c.status == "prospecto"),
                "subtitulado": sum(1 for c in v.clips if c.status == "subtitulado"),
                "en_revision": sum(1 for c in v.clips if c.status == "en_revision"),
                "publicado": sum(1 for c in v.clips if c.status == "publicado"),
            }
            results.append(v_dict)
        return results


@app.get("/clients")
async def get_clients() -> list[str]:
    """Return all unique client/brand names registered in the database, sorted alphabetically."""
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Video

    with Session(engine) as session:
        records = session.exec(select(Video.cliente).where(col(Video.cliente).is_not(None))).all()
        clients = sorted(list({c.strip() for c in records if c and c.strip()}))
        return clients


@app.get("/videos/lookup")
async def lookup_video_by_url(url: str) -> dict[str, Any]:
    """
    Check if a YouTube URL was previously processed.
    Returns the video record (with id, title, clips_count) if found,
    or raises 404 if not in the database.
    """
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Video
    from clipfinder.downloader import _extract_video_id

    # Normalize: strip trailing slash and whitespace
    normalized_url = url.strip().rstrip("/")
    input_vid = _extract_video_id(normalized_url) if ("youtube.com" in normalized_url or "youtu.be" in normalized_url) else None

    with Session(engine) as session:
        videos = session.exec(
            select(Video).where(col(Video.source_url).is_not(None)).order_by(col(Video.id).desc())
        ).all()

        for v in videos:
            stored = (v.source_url or "").strip().rstrip("/")
            stored_vid = _extract_video_id(stored) if ("youtube.com" in stored or "youtu.be" in stored) else None

            # Match exact URL or same YouTube video ID
            is_match = (stored == normalized_url) or (
                input_vid and stored_vid and input_vid == stored_vid and input_vid != "video"
            )

            if is_match:
                return {
                    "found": True,
                    "id": v.id,
                    "title": v.title,
                    "channel": v.channel,
                    "provider": v.provider,
                    "llm_model": v.llm_model,
                    "source_url": v.source_url,
                    "duration_seconds": v.duration_seconds,
                    "created_at": v.created_at.isoformat(),
                    "clips_count": len(v.clips),
                }

    raise HTTPException(status_code=404, detail="Video not found in history")


@app.get("/videos/{video_id}")
async def get_video(video_id: int) -> dict[str, Any]:
    """Get a single video record with its clip count."""
    from sqlmodel import Session
    from clipfinder.db import engine
    from clipfinder.models import Video

    with Session(engine) as session:
        v = session.get(Video, video_id)
        if not v:
            raise HTTPException(status_code=404, detail="Video no encontrado")
        return {
            "id": v.id,
            "title": v.title,
            "channel": v.channel,
            "provider": v.provider,
            "llm_model": v.llm_model,
            "source_url": v.source_url,
            "duration_seconds": v.duration_seconds,
            "cliente": v.cliente,
            "created_at": v.created_at.isoformat(),
            "clips_count": len(v.clips),
        }


@app.get("/videos/{video_id}/clips")
async def get_video_clips(video_id: int) -> list[dict[str, Any]]:
    """Get all clips belonging to a video."""
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Clip

    with Session(engine) as session:
        clips = session.exec(
            select(Clip).where(Clip.video_id == video_id).order_by(col(Clip.score).desc())
        ).all()
        return [c.model_dump() for c in clips]



class UpdateClipRequest(BaseModel):
    status: str | None = None
    title: str | None = None
    caption: str | None = None
    hashtags: str | None = None
    start_seconds: float | None = None
    end_seconds: float | None = None


@app.patch("/clips/{clip_id}")
async def update_clip(clip_id: int, req: UpdateClipRequest) -> dict[str, Any]:
    """Update clip status, title, copy or fine-tune timestamps."""
    from datetime import datetime, timezone
    from sqlmodel import Session
    from clipfinder.db import engine
    from clipfinder.models import Clip, ClipStatus

    with Session(engine) as session:
        clip = session.get(Clip, clip_id)
        if not clip:
            raise HTTPException(status_code=404, detail="Clip no encontrado")

        if req.status:
            try:
                clip.status = ClipStatus(req.status)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Estado inválido: {req.status}")
        if req.title is not None:
            clip.title = req.title
        if req.caption is not None:
            clip.caption = req.caption
        if req.hashtags is not None:
            clip.hashtags = req.hashtags
        if req.start_seconds is not None:
            clip.start_seconds = req.start_seconds
        if req.end_seconds is not None:
            clip.end_seconds = req.end_seconds

        clip.updated_at = datetime.now(timezone.utc)
        session.add(clip)
        session.commit()
        session.refresh(clip)
        return clip.model_dump()


@app.get("/clips")
async def filter_clips(status: str | None = None, cliente: str | None = None) -> list[dict[str, Any]]:
    """Filter clips across the database by status or client."""
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Clip, ClipStatus, Video

    with Session(engine) as session:
        stmt = select(Clip).join(Video)
        if status:
            try:
                st_enum = ClipStatus(status)
                stmt = stmt.where(Clip.status == st_enum)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Estado inválido: {status}")
        if cliente:
            stmt = stmt.where(Video.cliente == cliente)

        stmt = stmt.order_by(col(Clip.score).desc())
        clips = session.exec(stmt).all()
        results: list[dict[str, Any]] = []
        for c in clips:
            c_dict = c.model_dump()
            if c.video:
                c_dict["video_source"] = c.video.source_url or c.video.source_path
                c_dict["cliente"] = c.video.cliente
                c_dict["video_title"] = c.video.title
                c_dict["channel"] = c.video.channel
                c_dict["provider"] = c.video.provider
                c_dict["llm_model"] = c.video.llm_model
            results.append(c_dict)
        return results


@app.get("/clips/{clip_id}/thumbnail")
async def get_clip_thumbnail(clip_id: int):
    """Return an exact video frame thumbnail at start_seconds for this clip."""
    import subprocess
    from sqlmodel import Session
    from clipfinder.db import engine
    from clipfinder.models import Clip
    from clipfinder.downloader import _extract_video_id

    start_sec = 0.0
    source_url = None
    source_path = None
    yt_id = None

    with Session(engine) as session:
        clip = session.get(Clip, clip_id)
        if not clip:
            raise HTTPException(status_code=404, detail="Clip no encontrado")
        start_sec = clip.start_seconds
        if clip.video:
            source_url = clip.video.source_url
            source_path = clip.video.source_path

    if source_url:
        yt_id = _extract_video_id(source_url)

    thumbs_dir = Path("outputs/thumbs")
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumbs_dir / f"clip_{clip_id}_{int(start_sec)}.jpg"

    if thumb_path.exists() and thumb_path.stat().st_size > 500:
        return FileResponse(str(thumb_path), media_type="image/jpeg")

    # Try extracting exact frame
    try:
        if source_path and Path(source_path).exists():
            cmd = [
                "ffmpeg", "-y", "-ss", str(start_sec), "-i", str(source_path),
                "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3", str(thumb_path)
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if thumb_path.exists() and thumb_path.stat().st_size > 500:
                return FileResponse(str(thumb_path), media_type="image/jpeg")
        elif source_url:
            import yt_dlp
            ydl_opts = {"quiet": True, "format": "bestvideo[height<=360]/worst"}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(source_url, download=False)
                stream_url = info.get("url") or (info.get("formats") and info["formats"][0].get("url"))
            if stream_url:
                cmd = [
                    "ffmpeg", "-y", "-ss", str(start_sec), "-i", stream_url,
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3", str(thumb_path)
                ]
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if thumb_path.exists() and thumb_path.stat().st_size > 500:
                    return FileResponse(str(thumb_path), media_type="image/jpeg")
    except Exception as exc:
        logger.warning(f"Error generating thumbnail for clip {clip_id}: {exc}")

    # Fallback to YouTube default thumbnail
    if yt_id:
        return RedirectResponse(f"https://img.youtube.com/vi/{yt_id}/mqdefault.jpg")
    raise HTTPException(status_code=404, detail="No se pudo obtener la miniatura")


@app.get("/videos/{video_id}/thumbnail")
async def get_video_frame_thumbnail(video_id: int, time: float = 0.0):
    """Return an exact video frame thumbnail at specified time (in seconds)."""
    import subprocess
    from sqlmodel import Session
    from clipfinder.db import engine
    from clipfinder.models import Video
    from clipfinder.downloader import _extract_video_id

    source_url = None
    source_path = None
    yt_id = None

    with Session(engine) as session:
        video = session.get(Video, video_id)
        if not video:
            raise HTTPException(status_code=404, detail="Video no encontrado")
        source_url = video.source_url
        source_path = video.source_path

    if source_url:
        yt_id = _extract_video_id(source_url)

    thumbs_dir = Path("outputs/thumbs")
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumbs_dir / f"vid_{video_id}_{int(time)}.jpg"

    if thumb_path.exists() and thumb_path.stat().st_size > 500:
        return FileResponse(str(thumb_path), media_type="image/jpeg")

    try:
        if source_path and Path(source_path).exists():
            cmd = [
                "ffmpeg", "-y", "-ss", str(time), "-i", str(source_path),
                "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3", str(thumb_path)
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if thumb_path.exists() and thumb_path.stat().st_size > 500:
                return FileResponse(str(thumb_path), media_type="image/jpeg")
        elif source_url:
            import yt_dlp
            ydl_opts = {"quiet": True, "format": "bestvideo[height<=360]/worst"}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(source_url, download=False)
                stream_url = info.get("url") or (info.get("formats") and info["formats"][0].get("url"))
            if stream_url:
                cmd = [
                    "ffmpeg", "-y", "-ss", str(time), "-i", stream_url,
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3", str(thumb_path)
                ]
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if thumb_path.exists() and thumb_path.stat().st_size > 500:
                    return FileResponse(str(thumb_path), media_type="image/jpeg")
    except Exception as exc:
        logger.warning(f"Error generating thumbnail for video {video_id} at {time}s: {exc}")

    if yt_id:
        return RedirectResponse(f"https://img.youtube.com/vi/{yt_id}/mqdefault.jpg")
    raise HTTPException(status_code=404, detail="No se pudo obtener la miniatura")



