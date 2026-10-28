"""Persistent, isolated music projects and background rendering."""
from __future__ import annotations

import json
import logging
import re
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from clipfinder.music import (
    LyricLine, SubtitleStyle, analyze_music, clipped_lines, make_ass, make_srt, translate_lyrics,
    caption_cues, compact_segments, lyrical_moments, repetition_moments, video_filter, clean_lyric, select_music_moments, tiktok_description,
)

router = APIRouter(prefix="/music", tags=["music"])
ROOT = Path(__file__).resolve().parent.parent / "outputs" / "music"
LOCK = threading.RLock()
ACTIVE: set[str] = set()
logger = logging.getLogger(__name__)


class MusicRequest(BaseModel):
    url: str
    language: Literal["auto", "en", "es"] = "auto"
    subtitle_mode: Literal["original", "spanish", "bilingual", "none"] = "spanish"
    provider: Literal["groq", "gemini"] = "groq"
    engine: Literal["auto", "local", "groq"] = "auto"
    youtube_browser: Literal["brave", "chrome", "edge", "firefox", "safari"] | None = None
    instrumental: bool = False
    clip_duration: int = Field(default=30, ge=20, le=90)
    max_clips: int = Field(default=4, ge=1, le=4)

    @field_validator("clip_duration", "max_clips", mode="before")
    @classmethod
    def normalize_legacy_clip_settings(cls, value, info):
        # Older saved projects used 15 seconds and up to 12 suggestions.
        if isinstance(value, int):
            return max(20, value) if info.field_name == "clip_duration" else min(4, value)
        return value

    @field_validator("url")
    @classmethod
    def youtube_url(cls, value):
        parsed = urlparse(value.strip())
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or host not in {
            "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
        } or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            raise ValueError("Ingresa un enlace válido de YouTube.")
        return value.strip()


class RetryMusicRequest(BaseModel):
    youtube_browser: Literal["brave", "chrome", "edge", "firefox", "safari"] | None = None


class LyricsUpdate(BaseModel):
    lyrics: list[LyricLine] = Field(max_length=4000)


class CaptionRequest(LyricsUpdate):
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)


class ExportRequest(CaptionRequest):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)

    @model_validator(mode="after")
    def valid_range(self):
        if self.end <= self.start:
            raise ValueError("El fin debe ser posterior al inicio.")
        return self


def directory(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise HTTPException(404, "Proyecto no encontrado")
    return ROOT / project_id


def read_project(project_id: str) -> dict:
    with LOCK:
        path = directory(project_id) / "project.json"
        if not path.exists():
            raise HTTPException(404, "Proyecto no encontrado")
        data = json.loads(path.read_text())
        if data["status"] in {"processing", "queued"} and project_id not in ACTIVE:
            data.update(status="error", error="El servidor se reinició durante el proceso. Crea un nuevo análisis.")
        if data.get("export", {}).get("status") == "processing" and project_id not in ACTIVE:
            data["export"].update(status="error", error="Exportación interrumpida. Puedes reintentar.")
        if data.get("duration", 0) and data.get("moments"):
            candidates = data.get("moment_candidates", data["moments"])
            data["moment_candidates"] = candidates
            data["moments"] = select_music_moments(
                candidates, [LyricLine(**line) for line in data.get("lyrics", [])],
                data["duration"], data.get("request", {}).get("clip_duration", 30),
                data.get("request", {}).get("max_clips", 4))
        for moment in data.get("moments", []):
            moment["post_description"] = tiktok_description(
                moment, [LyricLine(**line) for line in data.get("lyrics", [])], data.get("title", ""),
                artist=data.get("artist", ""), genre=data.get("genre", ""))
        return data


def update(project_id: str, **values) -> dict:
    with LOCK:
        data = read_project(project_id)
        data.update(values)
        path = directory(project_id) / "project.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temp.replace(path)
        return data


def launch(project_id: str, task, *args):
    with LOCK:
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        ACTIVE.add(project_id)

    def run():
        try:
            task(project_id, *args)
        finally:
            with LOCK:
                ACTIVE.discard(project_id)
    threading.Thread(target=run, daemon=True).start()


def command(args: list[str], timeout=1200):
    try:
        return subprocess.run(args, capture_output=True, text=True, check=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        logger.error("Music media command failed: %s", exc.stderr[-3000:])
        raise RuntimeError("No se pudo procesar el video con FFmpeg. Revisa que esté instalado y que incluya libass.") from exc


def transcribe_project(project_id: str, req: MusicRequest, force_alignment: bool = False):
    from clipfinder.models import TranscriptSegment
    import os
    folder = directory(project_id)
    update(project_id, status="processing", progress=65, step="Obteniendo letra original…", error=None)
    segments: list[TranscriptSegment] = []
    method = ""
    # Audio is already downloaded: a second YouTube request can stall behind login/rate limits.
    # Music also needs word timestamps, which long YouTube caption paragraphs lack.
    def on_progress(percent: int, count: int):
        update(project_id, progress=66 + int(min(100, percent) * .08),
               step=f"Transcribiendo letra · {percent}% del audio · {count} segmentos",
               transcription_percent=percent, transcription_segments=count)

    def on_stage(stage: str):
        update(project_id, step=stage, progress=66)

    if req.engine == "groq" or (req.engine == "auto" and os.getenv("GROQ_API_KEY")):
        from clipfinder.groq_whisper import transcribe_with_groq
        on_stage("Transcribiendo el audio con Groq Whisper…")
        segments, _ = transcribe_with_groq(
            folder / "audio.wav", language=None if req.language == "auto" else req.language,
            progress_callback=on_progress)
        method = "Groq Whisper"
    else:
        from clipfinder.transcriber import transcribe
        on_stage("Preparando Whisper local…")
        segments, _ = transcribe(
            folder / "audio.wav", language=None if req.language == "auto" else req.language,
            vad_filter=False, progress_callback=on_progress, stage_callback=on_stage)
        method = "Whisper local"
    duration = read_project(project_id)["duration"]
    lines = compact_segments(segments, duration)
    update(project_id, lyrics=[line.model_dump() for line in lines], transcription_method=method,
           warnings=["Revisa la letra y los tiempos: el reconocimiento de canto puede contener errores."] if lines else
           ["No se detectó letra. Puedes analizar y exportar sin subtítulos o añadir frases manualmente."])
    update(project_id, raw_transcription=[line.model_dump() for line in lines],
           review_version=0, review_error=None)
    improve_lyrics(project_id, req.provider)


def improve_lyrics(project_id: str, provider: str):
    """Revise intact phrases before translation; persist a recoverable source snapshot."""
    from clipfinder.music_review import phrase_lines, review_lyrics
    data = read_project(project_id)
    source = [LyricLine(**line) for line in data["lyrics"]]
    if not source:
        update(project_id, status="done", progress=100, step="No se detectó letra para revisar")
        return
    try:
        update(project_id, status="processing", progress=75, step="Revisando letra original con contexto…",
               review_backup=data["lyrics"],
               raw_transcription=data.get("raw_transcription", data["lyrics"]), review_error=None)
        phrases = phrase_lines(source)
        def save_review(completed, changes, doubts, count, total):
            update(project_id, progress=75 + int(9*count/max(1, total)),
                   step=f"Revisando letra · {count}/{total} frases",
                   review_changes=changes, review_doubts=doubts)
        reviewed, changes, doubts = review_lyrics(
            phrases, provider, data.get("title", ""), directory(project_id) / "audio.wav", save_review)
        update(project_id, lyrics=[row.model_dump() for row in reviewed], review_changes=changes,
               review_doubts=doubts, review_version=1, review_error=None,
               review_method="audio" if provider == "gemini" and (directory(project_id)/"audio.wav").exists() else "context",
               translation_error=None, moments=data.get("acoustic_moments", []),
               moment_candidates=data.get("acoustic_moments", []))
        if data["request"].get("subtitle_mode") in {"spanish", "bilingual"}:
            translate_project(project_id, provider)
        else:
            update(project_id, status="done", progress=100, step="Letra original revisada")
        # Recompute grounded quotes/IDs after regrouping, without re-downloading audio.
        refresh_highlights(project_id, provider, finish=False)
        update(project_id, status="done", progress=100, step="Revisión lista; traducción pendiente" if read_project(project_id).get("translation_error") else "Revisión de letra completada")
    except Exception as exc:
        logger.exception("Lyric revision failed")
        update(project_id, status="done", progress=100, step="Revisión pendiente; letra conservada",
               review_error=str(exc))


@router.post("/projects/{project_id}/review")
def revise_saved_lyrics(project_id: str):
    with LOCK:
        data = read_project(project_id)
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        if not data.get("lyrics"):
            raise HTTPException(422, "Añade o transcribe la letra antes de revisarla.")
        update(project_id, status="queued", step="Preparando revisión de letra…")
        launch(project_id, improve_lyrics, data["request"]["provider"])
    return {"status": "processing"}


def translate_project(project_id: str, provider: str):
    update(project_id, status="processing", progress=85, step="Traduciendo letra al español…", error=None)
    try:
        saved = read_project(project_id)
        lines = [LyricLine(**line) for line in saved["lyrics"]]
        pending = [line for line in lines if not line.spanish.strip()] if saved.get("translation_error") else lines
        by_id = {line.id: line for line in lines}
        def save_block(completed, count, total):
            by_id.update({line.id: line for line in completed})
            update(project_id, lyrics=[by_id[line.id].model_dump() for line in lines],
                   progress=85 + int(14*count/max(total, 1)),
                   step=f"Traduciendo letra · {count}/{total} frases")
        result = translate_lyrics(pending, provider, progress_callback=save_block)
        by_id.update({line.id: line for line in result})
        translated = [by_id[line.id] for line in lines]
        by_id = {line.id: line for line in translated}
        moments = read_project(project_id)["moments"]
        for moment in moments:
            quote = by_id.get(moment.get("quote_id"))
            if quote:
                moment["quote"] = clean_lyric(quote.spanish or quote.original)
        update(project_id, lyrics=[line.model_dump() for line in translated], moments=moments,
               status="done", progress=100, step="Análisis musical listo", translation_error=None)
    except Exception as exc:
        logger.exception("Music translation failed")
        update(project_id, status="done", progress=100, step="Música lista; traducción pendiente", error=None,
               translation_error=str(exc))


def analyze_project(project_id: str, req: MusicRequest):
    try:
        import yt_dlp
        from clipfinder.youtube_access import youtube_options
        folder = directory(project_id)
        update(project_id, progress=5, step="Consultando video de YouTube…")
        options = {**youtube_options(req.url, browser_override=req.youtube_browser), "quiet": True, "noplaylist": True, "socket_timeout": 30}
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(req.url, download=False)
        if not info or info.get("is_live") or not 0 < float(info.get("duration") or 0) <= 1800:
            raise ValueError("Elige una canción o video de hasta 30 minutos; no se admiten directos.")
        update(project_id, title=info.get("title", "Canción"), artist=info.get("artist") or "",
               genre=info.get("genre") or "", progress=10, step="Descargando video y audio originales…")
        def progress(event):
            if event.get("status") == "downloading":
                total = event.get("total_bytes") or event.get("total_bytes_estimate") or 1
                update(project_id, progress=10 + min(30, int(30 * event.get("downloaded_bytes", 0) / total)))
        with yt_dlp.YoutubeDL({**options,
            "format": "bestvideo[vcodec^=avc1][height<=1080]+bestaudio/best[ext=mp4]/best",
            "outtmpl": str(folder / "source.%(ext)s"), "merge_output_format": "mp4",
            "progress_hooks": [progress],
        }) as ydl:
            ydl.download([req.url])
        source = next((p for p in folder.glob("source.*") if p.suffix in {".mp4", ".mkv", ".webm", ".mov"}), None)
        if source is None:
            raise RuntimeError("YouTube no devolvió un video descargable.")
        update(project_id, progress=42, step="Preparando reproducción y análisis…")
        # Browser-compatible video; preserve original file for exports.
        command(["ffmpeg", "-y", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0",
                 "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                 "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(folder / "preview.mp4")])
        command(["ffmpeg", "-y", "-i", str(source), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(folder / "audio.wav")])
        update(project_id, progress=55, step="Detectando energía y cambios rítmicos…", source_file=source.name)
        probe = command(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                         "stream=width,height", "-of", "json", str(source)])
        stream = json.loads(probe.stdout)["streams"][0]
        analysis = analyze_music(folder / "audio.wav", req.clip_duration, req.max_clips)
        update(project_id, **analysis, moment_candidates=analysis["moments"], acoustic_moments=analysis["moments"], media_ready=True, aspect_ratio=stream["width"] / stream["height"])
        if req.instrumental:
            update(project_id, status="done", progress=100, step="Análisis instrumental listo")
        else:
            try:
                transcribe_project(project_id, req)
            except Exception as exc:
                logger.exception("Music transcription failed")
                update(project_id, status="done", progress=100, step="Música lista; letra pendiente", lyrics_error=str(exc))
    except Exception as exc:
        from clipfinder.youtube_access import download_error_message, requires_youtube_login
        logger.exception("Music analysis failed")
        needs_session = requires_youtube_login(exc)
        message = ("YouTube requiere verificar tu sesión antes de descargar este video. "
                   "Abre el video en Brave con tu sesión iniciada y utiliza el botón de reintento.") if needs_session else download_error_message(exc)
        update(project_id, status="error", error=message,
               error_code="youtube_session_required" if needs_session else "analysis_failed",
               step="YouTube solicita verificar la sesión" if needs_session else "No se pudo completar el análisis")


@router.get("/library")
def music_library():
    from clipfinder.music_library import list_assets
    return [asset for asset in list_assets() if asset["origin"] == "Tu biblioteca"]


@router.get("/library/{asset_id}/file")
def library_file(asset_id: str):
    from clipfinder.music_library import asset_by_id
    asset, path = asset_by_id(asset_id)
    return FileResponse(path, media_type="image/gif" if asset["kind"] == "gif" else "image/png")


@router.post("/library")
async def upload_background(request: Request, title: str = "Mi fondo", theme: str = "nostalgia"):
    from clipfinder.music_library import import_asset
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > 20 * 1024 * 1024:
            raise HTTPException(413, "El archivo debe pesar como máximo 20 MB.")
        chunks.append(chunk)
    return import_asset(b"".join(chunks), title, theme)


@router.post("/projects")
def create_project(req: MusicRequest):
    project_id = uuid.uuid4().hex
    folder = directory(project_id)
    folder.mkdir(parents=True)
    data = {"id": project_id, "status": "queued", "progress": 0, "step": "En cola…", "title": "Nueva canción",
            "request": req.model_dump(), "lyrics": [], "timeline": [], "moments": [], "duration": 0,
            "media_ready": False, "warnings": []}
    with LOCK:
        (folder / "project.json").write_text(json.dumps(data), encoding="utf-8")
        launch(project_id, analyze_project, req)
    return {"id": project_id}


@router.post("/projects/{project_id}/retry")
def retry_project(project_id: str, body: RetryMusicRequest):
    with LOCK:
        data = read_project(project_id)
        if project_id in ACTIVE or data["status"] != "error":
            raise HTTPException(409, "Solo se pueden reintentar análisis detenidos por un error.")
        req = MusicRequest(**{**data["request"], "youtube_browser": body.youtube_browser})
        update(project_id, status="queued", error=None, error_code=None, progress=0,
               step="Preparando reintento…")
        # Browser access is opt-in per attempt; never persist it in .env or the project request.
        if data.get("media_ready") and (directory(project_id) / "audio.wav").is_file():
            launch(project_id, resume_lyrics, req)
        else:
            launch(project_id, analyze_project, req)
    return {"id": project_id, "status": "queued"}


@router.get("/projects")
def list_projects():
    projects = []
    for path in sorted(ROOT.glob("*/project.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        data = read_project(path.parent.name)
        projects.append({key: data.get(key) for key in ("id", "title", "status", "duration")})
    return projects


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    return read_project(project_id)


def validate_lines(lines: list[LyricLine], duration: float):
    if len({line.id for line in lines}) != len(lines):
        raise HTTPException(422, "Los identificadores de las frases deben ser únicos.")
    if any(line.end > duration + 0.05 for line in lines):
        raise HTTPException(422, "Hay frases fuera de la duración de la canción.")
    if any(a.start > b.start for a, b in zip(lines, lines[1:])):
        raise HTTPException(422, "Ordena las frases por tiempo de inicio.")


@router.patch("/projects/{project_id}/lyrics")
def save_lyrics(project_id: str, body: LyricsUpdate):
    with LOCK:
        data = read_project(project_id)
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        validate_lines(body.lyrics, data["duration"])
        return update(project_id, lyrics=[line.model_dump() for line in body.lyrics])


@router.post("/projects/{project_id}/translate")
def retry_translation(project_id: str):
    data = read_project(project_id)
    if not data["lyrics"]:
        raise HTTPException(422, "Añade letra antes de traducir.")
    with LOCK:
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        update(project_id, status="queued", step="Preparando traducción…")
        launch(project_id, translate_project if data.get("review_version") else improve_lyrics, data["request"]["provider"])
    return {"status": "processing"}


def resume_lyrics(project_id: str, request: MusicRequest):
    try:
        transcribe_project(project_id, request, force_alignment=True)
        update(project_id, lyrics_error=None)
    except Exception as exc:
        logger.exception("Music transcription recovery failed")
        update(project_id, status="done", progress=100, step="Audio listo; transcripción pendiente", lyrics_error=str(exc))


@router.post("/projects/{project_id}/transcribe")
def retry_transcription(project_id: str):
    data = read_project(project_id)
    if not data["media_ready"]:
        raise HTTPException(422, "Primero completa la descarga y el análisis musical.")
    with LOCK:
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        update(project_id, status="queued", step="Preparando transcripción…")
        launch(project_id, resume_lyrics, MusicRequest(**data["request"]))
    return {"status": "processing"}


@router.post("/projects/{project_id}/captions")
def preview_captions(project_id: str, body: CaptionRequest):
    data = read_project(project_id)
    validate_lines(body.lyrics, data["duration"])
    cues = caption_cues(body.lyrics, body.style, strict=False)
    return {"cues": cues, "estimated": any(cue["timing"] == "estimated" for cue in cues)}


def refresh_highlights(project_id: str, provider: str, finish: bool = True):
    data = read_project(project_id)
    update(project_id, status="processing", progress=76, step="Buscando coros y frases que conectan…")
    lines = [LyricLine(**line) for line in data["lyrics"]]
    baseline = data.get("acoustic_moments", [m for m in data["moments"] if not m.get("kind") or m["kind"] == "energy"])
    acoustic = [{**moment, "kind": "energy"} for moment in baseline]
    repeated = repetition_moments(lines, data["duration"], min(30, data["request"]["clip_duration"]))
    editorial, error = [], None
    if lines:
        try:
            editorial = lyrical_moments(lines, data["duration"], provider)
        except Exception as exc:
            logger.warning("Music lyrical analysis unavailable: %s", exc)
            error = "No se pudo completar el análisis de letra con IA. Puedes reintentarlo; la energía y la repetición siguen disponibles."
    moments = []
    # Prefer grounded editorial phrases and repeated lyrics; retain energetic alternatives.
    for moment in editorial + repeated + acoustic:
        if not any(moment["kind"] == existing["kind"] and
                   abs(moment["start"] - existing["start"]) < 5 for existing in moments):
            moments.append(moment)
    values = {"moments": select_music_moments(moments, lines, data["duration"],
                  data["request"]["clip_duration"], data["request"].get("max_clips", 4)),
              "moment_candidates": moments, "acoustic_moments": baseline, "insights_error": error,
              "insights_version": 2}
    if finish:
        values.update(status="done", progress=100, step="Coros y frases listos para revisar")
    update(project_id, **values)


@router.post("/projects/{project_id}/highlights")
def find_highlights(project_id: str):
    with LOCK:
        data = read_project(project_id)
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        if not data["media_ready"]:
            raise HTTPException(422, "Primero completa el análisis musical.")
        update(project_id, status="queued", step="Preparando análisis de letra…")
        launch(project_id, refresh_highlights, data["request"]["provider"])
    return {"status": "processing"}


def render_project(project_id: str, body: ExportRequest, export_id: str):
    try:
        data = read_project(project_id)
        folder = directory(project_id)
        lines = clipped_lines(body.lyrics, body.start, body.end)
        ass_file = folder / f"{export_id}.ass"
        ass_file.write_text(make_ass(body.lyrics, body.style, body.start, body.end, song_title=data.get("title", "")), encoding="utf-8")
        for mode in ("original", "spanish"):
            # Original-only/instrumental projects still export without a translated track.
            if mode == "original" or all(line.spanish.strip() for line in lines):
                (folder / f"{export_id}.{mode}.srt").write_text(make_srt(body.lyrics, mode, body.style, body.start, body.end), encoding="utf-8")
        output = folder / f"{export_id}.mp4"
        args = ["ffmpeg", "-y", "-ss", str(body.start), "-i", str(folder / data["source_file"])]
        video_input = "0:v:0"
        if body.style.background_id:
            from clipfinder.music_library import asset_by_id
            asset, background = asset_by_id(body.style.background_id)
            args += (["-stream_loop", "-1"] if asset["kind"] == "gif" else ["-loop", "1"])
            args += ["-i", str(background)]
            video_input = "1:v:0"
        args += ["-t", str(body.end - body.start), "-map", video_input, "-map", "0:a:0"]
        filters = video_filter(body.style)
        filters += f",ass=filename='{ass_file}'"
        args += ["-vf", filters]
        # Keep source audio channels; no speech loudness normalization.
        args += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(output)]
        command(args)
        update(project_id, export={"id": export_id, "status": "done", "start": body.start, "end": body.end,
                                   "spanish_srt": all(line.spanish.strip() for line in lines),
                                   "layout": body.style.layout})
    except Exception as exc:
        logger.exception("Music render failed")
        update(project_id, export={"id": export_id, "status": "error", "error": str(exc)})


@router.post("/projects/{project_id}/exports")
def export_project(project_id: str, body: ExportRequest):
    with LOCK:
        data = read_project(project_id)
        if project_id in ACTIVE:
            raise HTTPException(409, "Espera a que termine el proceso actual.")
        if not data["media_ready"] or body.end > data["duration"] + 0.05:
            raise HTTPException(422, "El recorte está fuera de la duración disponible.")
        validate_lines(body.lyrics, data["duration"])
        if body.style.background_id:
            from clipfinder.music_library import asset_by_id
            asset_by_id(body.style.background_id)
            body.style.layout = "vertical_crop"
        # Fail before creating a job when required translations are missing.
        try:
            make_ass(body.lyrics, body.style, body.start, body.end)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        export_id = uuid.uuid4().hex
        update(project_id, lyrics=[line.model_dump() for line in body.lyrics], editor_style=body.style.model_dump(),
               export={"id": export_id, "status": "processing"})
        launch(project_id, render_project, body, export_id)
    return {"id": export_id}


@router.get("/projects/{project_id}/files/{filename}")
def project_file(project_id: str, filename: str):
    data = read_project(project_id)
    if filename == "preview.mp4":
        if not data["media_ready"]:
            raise HTTPException(404, "Vista previa todavía no disponible")
        return FileResponse(directory(project_id) / filename, media_type="video/mp4")
    if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|original\.srt|spanish\.srt)", filename):
        raise HTTPException(404, "Archivo no encontrado")
    path = directory(project_id) / filename
    if not path.is_file() or (data.get("export", {}).get("id") == filename.split(".")[0]
                              and data["export"]["status"] != "done"):
        raise HTTPException(404, "Archivo no disponible")
    return FileResponse(path, filename=f"clypfast-{filename}", media_type="video/mp4" if filename.endswith("mp4") else "application/x-subrip")
