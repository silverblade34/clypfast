"""LLM Analyzer — chunks transcript and calls Groq/Gemini to detect viral moments."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Literal

from clipfinder.models import ClipCandidate, LLMClipsResponse, TranscriptSegment

LLMProvider = Literal["groq", "gemini"]

# ── Model registries ──────────────────────────────────────────────────────────

GROQ_MODELS = {
    "fast": "groq/compound-mini",
    "balanced": "groq/compound",
    "smart": "groq/compound",
    "default": "groq/compound",
}

GEMINI_MODELS = {
    "fast": "gemini-3.5-flash-lite",
    "balanced": "gemini-3.5-flash-lite",
    "smart": "gemini-3.5-flash-lite",
    "default": "gemini-3.5-flash-lite",
}

# ── Chunking ──────────────────────────────────────────────────────────────────

CHUNK_DURATION_SECONDS: float = 300.0  # 5 minutes per chunk
MAX_TOKENS_PER_CHUNK: int = 12_000     # rough token safety limit

# ── Prompts por Tipo de Contenido ─────────────────────────────────────────────

CONTENT_TYPE_PROMPTS: dict[str, str] = {
    "politica": (
        "CRITERIOS ESPECÍFICOS (POLÍTICA, DEBATE Y SHOW DE OPINIÓN):\n"
        "- Declaraciones polémicas, acusaciones directas, filtraciones o revelaciones.\n"
        "- Momentos de alta tensión, confrontación directa o desacuerdo entre participantes.\n"
        "- Mención explícita de figuras públicas, personajes polémicos o noticias calientes.\n"
        "- Tono de 'escándalo', indignación o argumentos provocadores para debates en comentarios."
    ),
    "streaming": (
        "CRITERIOS ESPECÍFICOS (STREAMING, GAMING Y REACCIONES):\n"
        "- Reacciones exageradas: gritos, carcajadas, sobresaltos o shock genuino.\n"
        "- Fails cómicos, jugadas épicas (clutch/comeback), o giros inesperados en vivo.\n"
        "- Picos de energía en la voz, momentos 'fuera de contexto' y anécdotas espontáneas."
    ),
    "entrevista": (
        "CRITERIOS ESPECÍFICOS (ENTREVISTA Y PODCAST REFLEXIVO):\n"
        "- Ganchos intelectuales y revelaciones personales profundas.\n"
        "- Datos sorprendentes, historias de superación o anécdotas con impacto emotivo.\n"
        "- Remates inspiradores, moralejas y lecciones de vida con coherencia narrativa."
    ),
    "educativo": (
        "CRITERIOS ESPECÍFICOS (EDUCATIVO, NEGOCIOS Y CHARLAS):\n"
        "- Consejos prácticos, métodos paso a paso y tácticas accionables.\n"
        "- Formato 'Mito vs Realidad', datos contraintuitivos y estadísticas impactantes.\n"
        "- Explicaciones sencillas de conceptos complejos o casos de estudio memorables."
    ),
    "comedia": (
        "CRITERIOS ESPECÍFICOS (COMEDIA Y ENTRETENIMIENTO):\n"
        "- Remate de chistes (punchlines) y momentos cómicos naturales.\n"
        "- Momentos incómodos, situaciones ridículas y quiebres de tono inesperados.\n"
        "- Sarcasmo fino o reacciones graciosas ante fallos o imprevistos."
    ),
    "vlog": (
        "CRITERIOS ESPECÍFICOS (VLOGS, VIAJES, EXPEDICIONES Y GASTRONOMÍA/LUGARES):\n"
        "- Momentos de asombro genuino al llegar a un lugar impresionante, paisaje o descubrir un rincón oculto.\n"
        "- Primeras reacciones y veredicto honesto al probar comida, platos exóticos o visitar restaurantes/cafés.\n"
        "- Imprevistos, dificultades, anécdotas de viaje, choques culturales y situaciones divertidas en ruta.\n"
        "- Consejos clave, precios reales, tips para turistas ('hack de viaje') y datos curiosos del destino.\n"
        "- Momentos de tensión o adrenalina durante expediciones, caminatas extremas o recorridos peligrosos/inusuales."
    ),
    "general": (
        "CRITERIOS GENERALES:\n"
        "1. 🎣 Ganchos fuertes (hooks que enganchan en los primeros 3 segundos)\n"
        "2. 💥 Remates, punch lines o revelaciones inesperadas\n"
        "3. 📊 Datos sorprendentes, estadísticas impactantes o afirmaciones contraintuitivas\n"
        "4. 😂 Humor genuino (no forzado)\n"
        "5. 😢 Momentos de emoción auténtica (alegría, shock, vulnerabilidad)\n"
        "6. 💡 Consejos prácticos, accionables y específicos\n"
        "7. 📖 Historias o anécdotas cortas y autocontenidas"
    ),
}

SYSTEM_PROMPT = """\
Eres un editor de video experto en contenido viral para TikTok, Instagram Reels y YouTube Shorts.
Tienes años de experiencia identificando qué momentos de un video largo se convierten en clips virales.
Tu análisis es preciso, honesto y orientado a resultados reales."""

USER_PROMPT_TEMPLATE = """\
Analiza la siguiente transcripción con timestamps y detecta exactamente {max_clips} momentos \
con mayor potencial viral para TikTok/Reels/Shorts.

{content_criteria}

EVITAR: transiciones vagas, introducciones genéricas, despedidas, silencio o relleno sin sustancia.

DURACIÓN IDEAL por clip: entre 30 y 90 segundos.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{{"clips": [{{"start_seconds": 0.0, "end_seconds": 0.0, "title": "Título del clip", "reason": "Por qué es viral", "score": 8, "caption": "Copy sugerido para TikTok/Reels con gancho y llamada a la acción", "hashtags": ["#tema1", "#tema2", "#tema3", "#tema4", "#tema5"]}}]}}

- "title": máximo 60 caracteres, en el mismo idioma del video
- "reason": 1-2 oraciones explicando el potencial viral específico
- "score": entero del 1 al 10 (10 = viral garantizado)
- "caption": 1-2 oraciones con copy atractivo y llamado a la acción para redes sociales
- "hashtags": lista de 5 a 8 hashtags altamente relevantes para el clip

Transcripción:
{transcript}"""


# ── Helpers ───────────────────────────────────────────────────────────────────


def _fmt(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def format_segments(segments: list[TranscriptSegment]) -> str:
    """Format segments as '[MM:SS - MM:SS] text' lines for the LLM prompt."""
    return "\n".join(
        f"[{_fmt(seg.start)} - {_fmt(seg.end)}] {seg.text}" for seg in segments
    )


def chunk_segments(
    segments: list[TranscriptSegment],
    chunk_duration: float = CHUNK_DURATION_SECONDS,
) -> list[list[TranscriptSegment]]:
    """
    Split segments into discrete time-based chunks of ~chunk_duration seconds.
    The last 3 segments of each chunk are prepended to the next chunk as
    overlap context so the LLM doesn't miss moments at chunk boundaries.
    """
    if not segments:
        return []

    chunks: list[list[TranscriptSegment]] = []
    current: list[TranscriptSegment] = []
    chunk_start = segments[0].start

    for seg in segments:
        current.append(seg)
        if seg.end - chunk_start >= chunk_duration:
            chunks.append(list(current))
            overlap = current[-3:]        # last 3 segs carry over as context
            current = list(overlap)
            # Advance chunk_start past the non-overlap portion of what we just flushed
            chunk_start = seg.end         # next chunk starts fresh from here

    if current:
        chunks.append(current)

    return chunks


def _extract_json(text: str) -> dict:
    """
    Robustly extract a JSON object from an LLM response string.
    Handles: plain JSON, markdown code blocks, extra whitespace.
    """
    # 1. Try direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 2. Try markdown code block
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Try first JSON object in the text
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not extract valid JSON from LLM response.\n"
        f"First 500 chars: {text[:500]}"
    )


# ── Fallback Clip Generator ───────────────────────────────────────────────────


def _generate_fallback_clips(
    segments: list[TranscriptSegment],
    target_count: int = 3,
) -> list[ClipCandidate]:
    """
    Generate fallback clips when LLM detection returns 0 results.
    Picks continuous chunks of 30-60 seconds from the transcript so the user
    never receives an empty list if speech content was present.
    """
    if not segments:
        return []

    total_duration = segments[-1].end - segments[0].start
    if total_duration < 20.0:
        return [
            ClipCandidate(
                start_seconds=segments[0].start,
                end_seconds=segments[-1].end,
                title="Momento Destacado (Completo)",
                reason="Segmento principal detectado del video",
                score=6,
                caption="Lo más destacado de esta sesión 🎬🔥 #viral #clip",
                hashtags=["#destacado", "#clip", "#viral", "#contenido", "#resumen"],
            )
        ]

    step = total_duration / (target_count + 1)
    fallbacks: list[ClipCandidate] = []

    for idx in range(1, target_count + 1):
        target_time = segments[0].start + step * idx
        start_seg_idx = 0
        for s_i, seg in enumerate(segments):
            if seg.start >= target_time:
                start_seg_idx = max(0, s_i - 1)
                break

        start_s = segments[start_seg_idx].start
        target_end_s = start_s + 45.0
        end_s = target_end_s

        for seg in segments[start_seg_idx:]:
            if seg.end >= target_end_s:
                end_s = seg.end
                break
        else:
            end_s = segments[-1].end

        # Short snippet for title
        snippet_words = " ".join(s.text.strip() for s in segments[start_seg_idx : start_seg_idx + 4])
        snippet_words = snippet_words.replace("\n", " ").strip()
        title = (snippet_words[:50] + "...") if len(snippet_words) > 50 else snippet_words
        if not title:
            title = f"Momento Destacado #{idx}"

        fallbacks.append(
            ClipCandidate(
                start_seconds=round(start_s, 2),
                end_seconds=round(end_s, 2),
                title=title,
                reason="Momento sugerido automáticamente a partir de la transcripción",
                score=6,
                caption=f"{title} 🔥 ¿Qué opinas? ¡Déjalo en los comentarios!",
                hashtags=["#destacado", "#clip", "#viral", "#video", "#tendencia"],
            )
        )

    return fallbacks


# ── LLM Callers ───────────────────────────────────────────────────────────────


def _call_groq(
    transcript: str,
    max_clips: int,
    model: str,
    api_key: str,
    content_type: str = "general",
) -> list[ClipCandidate]:
    """Call the Groq API and parse the response."""
    from groq import Groq

    client = Groq(api_key=api_key)
    criteria = CONTENT_TYPE_PROMPTS.get(content_type, CONTENT_TYPE_PROMPTS["general"])
    prompt = USER_PROMPT_TEMPLATE.format(
        max_clips=max_clips,
        content_criteria=criteria,
        transcript=transcript,
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.25,
        max_tokens=4096,
    )

    content = response.choices[0].message.content or ""
    raw = _extract_json(content)
    return LLMClipsResponse(**raw).clips


def _call_gemini(
    transcript: str,
    max_clips: int,
    model: str,
    api_key: str,
    content_type: str = "general",
) -> list[ClipCandidate]:
    """Call the Google Gemini API and parse the response."""
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    gem = genai.GenerativeModel(
        model_name=model,
        system_instruction=SYSTEM_PROMPT,
    )

    criteria = CONTENT_TYPE_PROMPTS.get(content_type, CONTENT_TYPE_PROMPTS["general"])
    prompt = USER_PROMPT_TEMPLATE.format(
        max_clips=max_clips,
        content_criteria=criteria,
        transcript=transcript,
    )

    response = gem.generate_content(
        prompt,
        generation_config={
            "temperature": 0.25,
            "max_output_tokens": 4096,
            "response_mime_type": "application/json",
        },
    )

    raw = _extract_json(response.text)
    return LLMClipsResponse(**raw).clips


# ── Deduplication ─────────────────────────────────────────────────────────────


def _deduplicate(clips: list[ClipCandidate], overlap_threshold: float = 0.5) -> list[ClipCandidate]:
    """
    Remove clips that overlap significantly with a higher-scored clip.
    Keeps the best clip when two overlap by > overlap_threshold of the shorter clip.
    """
    # Sort by score descending so we keep the best one in each overlapping group
    sorted_clips = sorted(clips, key=lambda c: c.score, reverse=True)
    kept: list[ClipCandidate] = []

    for candidate in sorted_clips:
        dominated = False
        for keeper in kept:
            overlap_start = max(candidate.start_seconds, keeper.start_seconds)
            overlap_end = min(candidate.end_seconds, keeper.end_seconds)
            if overlap_end > overlap_start:
                overlap_dur = overlap_end - overlap_start
                candidate_dur = candidate.end_seconds - candidate.start_seconds
                if candidate_dur > 0 and (overlap_dur / candidate_dur) > overlap_threshold:
                    dominated = True
                    break
        if not dominated:
            kept.append(candidate)

    return kept


# ── Public API ────────────────────────────────────────────────────────────────

ProgressCallback = Callable[[int, int, str | None], None]


def analyze_segments(
    segments: list[TranscriptSegment],
    provider: LLMProvider,
    api_key: str,
    model: str | None = None,
    max_clips: int = 12,
    content_type: str = "general",
    progress_callback: ProgressCallback | None = None,
) -> list[ClipCandidate]:
    """
    Analyze transcript segments and return the top viral clip candidates.

    Args:
        segments: Whisper transcript segments with timestamps.
        provider: 'groq' or 'gemini'.
        api_key: API key for the chosen provider.
        model: Specific model name, or None to use the provider default.
        max_clips: Maximum clips to return in total.
        content_type: Target niche ('politica', 'entrevista', 'streaming', 'educativo', 'comedia', 'vlog', 'general').
        progress_callback: Optional fn(current_chunk, total_chunks, error_msg).

    Returns:
        List of ClipCandidate sorted by score descending, deduplicated.
    """
    if not segments:
        return []

    # Resolve model name
    if model is None:
        model = GROQ_MODELS["default"] if provider == "groq" else GEMINI_MODELS["default"]

    # Choose caller
    caller = _call_groq if provider == "groq" else _call_gemini

    # Chunk the transcript
    chunks = chunk_segments(segments)
    total = len(chunks)
    clips_per_chunk = max(3, (max_clips * 2) // total)  # ask for 2x per chunk, filter later

    all_clips: list[ClipCandidate] = []

    for i, chunk in enumerate(chunks, 1):
        error_msg: str | None = None
        start_s = chunk[0].start if chunk else 0.0
        end_s = chunk[-1].end if chunk else 0.0
        time_range = f"{int(start_s // 60):02d}:{int(start_s % 60):02d} - {int(end_s // 60):02d}:{int(end_s % 60):02d}"

        try:
            transcript_text = format_segments(chunk)
            chunk_clips = caller(
                transcript_text,
                clips_per_chunk,
                model,
                api_key,
                content_type=content_type,
            )
            all_clips.extend(chunk_clips)
        except Exception as exc:
            error_msg = str(exc)[:120]

        if progress_callback:
            chunk_info = {
                "chunk_current": i,
                "chunk_total": total,
                "chunk_time_range": time_range,
                "clips_found_so_far": len(all_clips),
                "latest_clips": [
                    {
                        "title": c.title,
                        "score": c.score,
                        "start_seconds": c.start_seconds,
                        "end_seconds": c.end_seconds,
                        "reason": c.reason,
                    }
                    for c in all_clips
                ],
            }
            try:
                progress_callback(i, total, error_msg, chunk_info)  # type: ignore[call-arg]
            except TypeError:
                progress_callback(i, total, error_msg)

    # Deduplicate, sort, and limit
    all_clips = _deduplicate(all_clips)
    all_clips.sort(key=lambda c: c.score, reverse=True)

    # Fallback guarantee: Never return 0 clips if transcript segments exist
    if not all_clips and segments:
        all_clips = _generate_fallback_clips(segments, target_count=min(3, max_clips))

    return all_clips[:max_clips]
