"""LLM Analyzer — chunks transcript and calls Groq/Gemini to detect viral moments."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Literal

from clipfinder.models import ClipCandidate, LLMClipsResponse, LLMSocialContentResponse, TranscriptSegment
from clipfinder.audio_peaks import correlate_clip_with_peaks, format_audio_peaks_for_prompt

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
    "irl_calle": (
        "CRITERIOS ESPECÍFICOS (IRL EN LA CALLE, BROMAS, SITUACIONES TENSAS Y CONFRONTACIÓN):\n"
        "- 🎭 BROMAS Y REVELACIONES (PRANKS): La ejecución de una situación absurda o broma pesada, el momento exacto de desconcierto de la víctima y la revelación ('mira la cámara', carcajadas).\n"
        "- ⚡ TENSIÓN Y CONFRONTACIÓN: Discusiones con extraños, personas hostiles, intervenciones de policías o seguridad, momentos incómodos ('cringe') o peligro inminente en la vía pública.\n"
        "- 😱 REACCIONES DE SHOCK Y SUSTOS: Gritos genuinos, carcajadas incontrolables, sobresaltos o expresiones de asombro de peatones y del streamer.\n"
        "- 💥 IMPREVISTOS Y CAOS URBANO: Caídas, accidentes leves, personajes extravagantes o espontáneos que interrumpen el en vivo.\n"
        "- 🗣️ FRASES DE ALERTA Y REMATES: Intercambios verbales directos y tensos ('¡Qué miras!', '¡Cuidado!', '¡Párate ahí!', '¿Qué te pasa?').\n"
        "- ⏱️ RITMO DINÁMICO: El clip debe empezar 3-5 segundos antes del incidente/broma para dar contexto, capturar el clímax y terminar justo en la reacción o remate."
    ),
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
        "- El nicho del canal NO limita los temas: en una entrevista de negocios, una historia personal puede ser el mejor candidato.\n"
        "- Busca pérdidas, familia, infancia, vulnerabilidad, fracasos, decisiones difíciles y progreso con hechos concretos; sin inventar intimidad ni premiar el sufrimiento por sí mismo.\n"
        "- Cada historia necesita situación inicial, cambio o dificultad, y consecuencia o reflexión. Incluye la pregunta si la respuesta sola no se entiende.\n"
        "- Compara candidatos personales, de superación, conflicto, humor y aprendizaje cuando existan; no llenes todos los cupos con consejos de negocios.\n"
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

# ── Stage 1: Clip Detection Prompts ─────────────────────────────────────────

SYSTEM_PROMPT = """\
Eres un detector experto de momentos virales en videos largos para TikTok, Instagram Reels y YouTube Shorts.
Tu único objetivo en esta etapa es encontrar QUÉ fragmentos del video valen la pena convertir en clip.
No te preocupes por el título definitivo ni por el contenido social: eso es trabajo de otra IA.
Tu tarea es identificar con precisión los momentos más potentes, con timestamps exactos, contexto claro y un score honesto."""

USER_PROMPT_TEMPLATE = """\
Analiza la siguiente transcripción con timestamps y detecta HASTA {max_clips} fragmentos \
con mayor potencial viral para TikTok/Reels/Shorts.

DATOS DEL VIDEO:
- Título: {video_title}
- Canal / Creador: {video_channel}

El título y el canal sirven de referencia, NO son una restricción temática.
Para entrevistas/podcasts, evalúa también historias personales, vínculos familiares,
pérdidas, fracasos y progreso, aunque el canal sea empresarial. Juzga la fuerza
narrativa del fragmento, sin asumir que una revelación íntima garantiza viralidad.

{content_criteria}

{audio_peaks_context}

EVITAR: introducciones genéricas, despedidas, silencios, transiciones sin contenido, relleno.

REGLA CRÍTICA DE DURACIÓN:
- DURACIÓN MÍNIMA: 20 segundos. DURACIÓN MÁXIMA: 120 segundos.
- Selecciona el mínimo intervalo que cuente una historia completa. Como guía,
  una anécdota suele necesitar 45-90 segundos y puede llegar a 120 si lo exige su cierre.
- Un clip de 20-35 segundos solo sirve si tiene contexto y conclusión propios;
  no lo elijas por ser corto ni lo alargues con segundos arbitrarios.
- NUNCA selecciones una sola frase aislada. Cada clip debe contener una idea completa con contexto, desarrollo y cierre.
- Verifica que (end_seconds - start_seconds) >= 20.
- Revisa el texto inmediatamente anterior y posterior antes de fijar límites.
  No empieces con referencias sin antecedente ("eso", "él", "si tú quieres") ni
  termines antes de la explicación, ejemplo o desenlace que da sentido al gancho.
- Si el bloque no permite reconstruir el contexto y el cierre, descarta el candidato.

PUNTUACIÓN EDITORIAL (no es una probabilidad de viralidad):
- 30% relato autónomo: contexto, desarrollo y cierre entendibles sin ver el episodio.
- 25% emoción, identificación o curiosidad auténticas.
- 20% situación o revelación concreta, fiel a lo que se dice.
- 15% gancho inicial y ritmo, sin sacrificar contexto.
- 10% motivo específico para compartir o comentar.
- Un grito o pico de volumen NO aumenta la puntuación por sí solo.
- Reserva 9-10 para candidatos excepcionales; no asignes 10 a todos.
- No rellenes cupos con frases genéricas o historias incompletas.

REGLA CRÍTICA DE TIMESTAMPS:
- Cada línea de la transcripción tiene su tiempo real entre corchetes, ej: "[34:15 - 35:02] ...".
- "start_seconds" y "end_seconds" deben ser los timestamps EXACTOS de la transcripción.
- Puedes usar formato "MM:SS" o segundos totales.
- PROHIBIDO usar tiempos relativos (ej. "00:15" cuando el texto dice "[34:15]").

PARA CADA CLIP, IDENTIFICA:
- El fragmento exacto con sus timestamps reales
- La idea central del clip (qué afirma, explica o revela el hablante)
- El tema superficial visible
- El argumento o afirmación principal
- El momento más potente del fragmento (la frase o revelación clave)
- Por qué tiene potencial viral (honesto, específico)
- Un título de trabajo provisional de 1 a 8 palabras (es solo interno, no el título final)
- Un score del 1 al 10

Responde ÚNICAMENTE con JSON válido con esta estructura exacta:
{{"clips": [
  {{
    "start_seconds": "MM:SS",
    "end_seconds": "MM:SS",
    "title": "Título provisional 1-8 palabras",
    "core_idea": "La idea profunda o argumento real del clip en 1-2 oraciones",
    "surface_topic": "El tema superficial visible en el clip",
    "key_argument": "La afirmación o argumento principal del hablante",
    "strongest_moment": "La frase o revelación más potente del fragmento",
    "reason": "Por qué este fragmento tiene potencial viral (específico)",
    "score": 8,
    "narrative_type": "personal",
    "context_complete": true,
    "context_reason": "Qué situación plantea, cómo la desarrolla y con qué cierra"
  }}
]}}

NOTA: Los campos "core_idea", "surface_topic", "key_argument" y "strongest_moment" son opcionales en el JSON \
pero muy valorados. Si el modelo los omite, el parsing seguirá funcionando correctamente.
Usa narrative_type: personal, superacion, conflicto, aprendizaje, humor u otro.
context_complete y context_reason deben justificar que el intervalo contiene el relato completo.

Transcripción:
{transcript}"""


# ── Stage 2: Social Content Analysis Prompts ─────────────────────────────────

STAGE2_SYSTEM_PROMPT = """\
La fidelidad al fragmento tiene prioridad absoluta sobre el atractivo del título.
Usa únicamente afirmaciones presentes en la transcripción del intervalo indicado.
No importes hechos del título del video ni de una idea central anterior.
No inventes consecuencias, cifras, causalidad ni superlativos.
El campo quote debe ser una cita textual continua de la transcripción que respalde
el hook. No se permite parafrasear quote. Si el fragmento no demuestra una tesis
dramática, escribe un título descriptivo y fiel.
Eres un editor de contenido viral para TikTok, Instagram Reels y YouTube Shorts.
Sabes exactamente cuál es la diferencia entre un buen fragmento de video y un buen clip para redes.
Tu especialidad es encontrar el ángulo más interesante dentro de un fragmento y convertirlo en contenido que detenga el scroll.
Nunca te quedas con el tema superficial. Siempre buscas la contradicción, la consecuencia oculta o la pregunta implícita que el propio clip puede responder.
Escribes con lenguaje concreto, directo y humano. Jamás usas frases genéricas de IA."""

STAGE2_USER_PROMPT_TEMPLATE = """\
Analiza el siguiente fragmento de video y genera el mejor contenido social posible para publicarlo en TikTok/Reels/Shorts.

INFORMACIÓN DEL VIDEO ORIGINAL:
- Título: {video_title}
- Canal / Creador: {video_channel}
- Tema general del video: {surface_topic}
- Idea central detectada (Stage 1): {core_idea}

TRANSCRIPCIÓN COMPLETA DEL FRAGMENTO ({start_time} – {end_time}):
{transcript}

---

ANTES DE ESCRIBIR NADA, HAZ ESTE ANÁLISIS INTERNO OBLIGATORIO:

1. ¿Cuál es el TEMA SUPERFICIAL del clip? (Lo que parece ser a primera vista)
2. ¿Cuál es REALMENTE la idea central? (Lo que el hablante está argumentando de fondo)
3. ¿Qué ejemplo concreto del clip ilustra mejor esa idea? (Una situación, dato o caso específico mencionado)
4. ¿Existe una CONTRADICCIÓN? (Dos cosas que se oponen o que parecen incompatibles)
5. ¿Existe una CONSECUENCIA INESPERADA? (Algo que pasa como resultado que no es obvio)
6. ¿Qué parte haría decir al espectador "¿cómo así?" o "¿en serio?" (El punto más sorprendente)
7. ¿Qué PREGUNTA queda implícita y el propio clip la responde? (La que debería estar en el título)
8. ¿Qué título entendería alguien que no conoce el contexto del video? (Sin jerga interna)

---

GENERACIÓN DE HOOKS:

Con base en ese análisis, genera INTERNAMENTE entre 5 y 10 candidatos de hook (título/frase gancho para TikTok).
Luego evalúa cada uno según estos criterios:
- Hook: ¿Detiene el scroll en menos de 2 segundos?
- Curiosidad: ¿Hace querer escuchar la explicación?
- Fidelidad: ¿El clip realmente responde lo que promete el título?
- Claridad: ¿Se entiende inmediatamente sin contexto previo?
- Naturalidad: ¿Parece escrito por una persona, no por una IA?
- Especificidad: Si el mismo título pudiera usarse en 100 videos distintos, penalízalo fuertemente.

Fórmulas que puedes explorar (úsalas para disparar ideas, no mecánicamente):
- Contradicción: "Ser pobre también significa pagar más."
- Consecuencia oculta: "La inseguridad también te hace ganar menos."
- Pregunta: "¿Por qué ser pobre termina saliendo más caro?"
- Dato/ejemplo: "Tres pasajes solo para conseguir una cita."
- Causa → consecuencia: "Cierras antes por miedo. También ganas menos."
- Romper creencia: "La pobreza no es solamente ganar poco."

REGLAS DE ORO PARA EL HOOK GANADOR:
- Entre 6 y 14 palabras. Legible en menos de 2 segundos.
- Sin tono académico, periodístico o de ensayo.
- PROHIBIDO: "El peligroso mito de...", "La importancia de...", "Análisis sobre...", "El impacto de..."
- El título debe ABRIR una pregunta que el clip pueda CERRAR.
- 100% honesto: lo que promete el título, el clip lo cumple.

SELECCIONA:
- El hook ganador → campo "hook"
- Los 3 mejores runners-up → campo "alternative_hooks" (lista de 3)

---

DESCRIPCIÓN PARA REDES SOCIALES:

Escribe una descripción con esta estructura OBLIGATORIA:
1. HOOK: La misma frase del hook o una variante directa (1 línea, gancho inmediato)
2. EJEMPLO CONCRETO: Describe brevemente el ejemplo o caso específico del clip que mejor ilustra la idea.
   Usa hechos, no paráfrasis genéricas. Ejemplo real: "Ir 3 veces por una cita = 3 pasajes. Cerrar antes por inseguridad = menos horas trabajando."
3. IDEA DEL CLIP: La conclusión o idea de fondo en 1-2 oraciones. Concreta, no poética.
4. REFLEXIÓN BREVE (OPCIONAL): Si hay algo genuinamente reflexivo que añadir, una sola oración en primera persona.
   Si no hay nada que añadir sin sonar genérico, OMÍTELA. No pongas reflexión de relleno.
5. PREGUNTA CTA: Una pregunta directa y específica que genere comentarios sobre el tema concreto del clip.
6. FUENTE:
   📌 {video_title}
   🎙 {video_channel}

PROHIBIDO en la descripción (frases genéricas de IA que matan la personalidad):
- "una cadena que asfixia los sueños"
- "quienes buscan ganarse la vida honradamente"
- "en un mundo donde..."
- "esto nos invita a reflexionar"
- "una problemática que afecta a miles"
- "el esfuerzo diario de quienes..."
- "una realidad que pocos quieren ver"
- Cualquier frase que pudiera servir para 100 videos distintos

PRINCIPIO: Concreto > Poético. Un hecho específico del clip tiene más impacto que cualquier metáfora genérica.

---

HASHTAGS: Entre 5 y 8, altamente relevantes para el tema específico del clip (no genéricos como #viral #contenido).

PREGUNTA DE ENGAGEMENT: Una pregunta directa, específica y basada en el contenido real del clip.
Ejemplo malo: "¿Qué opinas de este tema?"
Ejemplo bueno: "¿Habías pensado que la inseguridad también te hace perder ingresos?"

---

Responde ÚNICAMENTE con JSON válido con esta estructura exacta:
{{
  "core_idea": "La idea profunda real del clip (puede diferir de la detectada en Stage 1 si encuentras algo mejor)",
  "surface_topic": "El tema superficial",
  "hidden_angle": "El ángulo más potente e inesperado que encontraste",
  "hook": "El título/hook TikTok ganador (6-14 palabras)",
  "alternative_hooks": ["Hook alternativo 1", "Hook alternativo 2", "Hook alternativo 3"],
  "quote": "Cita textual continua del intervalo que respalda el hook; nunca parafraseada",
  "social_description": "Descripción completa con estructura HOOK→EJEMPLO→IDEA→REFLEXIÓN(opcional)→PREGUNTA CTA→FUENTE",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "engagement_question": "Pregunta específica y concreta para generar comentarios",
  "social_score": 8
}}"""


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
    video_title: str | None = None,
    video_channel: str | None = None,
) -> list[ClipCandidate]:
    """
    Generate evenly spaced fallback clips from transcript if the LLM produces 0 clips.
    Guarantees the system never returns an empty list if transcript segments exist.
    """
    if not segments:
        return []

    v_title = (video_title or "Video original").strip()
    v_chan = (video_channel or "Canal de origen").strip()

    total_duration = segments[-1].end - segments[0].start
    if total_duration < 15.0:
        return [
            ClipCandidate(
                start_seconds=segments[0].start,
                end_seconds=segments[-1].end,
                title="Momento Destacado (Completo)",
                reason="Segmento principal detectado del video",
                score=6,
                caption=f"Lo más destacado de esta sesión 🎬🔥\n\n💡 Reflexión: Una lección clave para aplicar de inmediato.\n\n¿Qué opinas? ¡Comenta abajo! 👇\n\n📌 Video: {v_title}\n🎙 Canal: {v_chan}",
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

        reason = "Momento sugerido automáticamente a partir de la transcripción"
        fallbacks.append(
            ClipCandidate(
                start_seconds=round(start_s, 2),
                end_seconds=round(end_s, 2),
                title=title,
                reason=reason,
                score=6,
                caption=f"{title} 🔥\n\n💡 Reflexión: Una perspectiva clave sobre este tema.\n\n¿Qué opinas? ¡Déjalo en los comentarios! 👇\n\n📌 Video: {v_title}\n🎙 Canal: {v_chan}",
                hashtags=["#destacado", "#clip", "#viral", "#video", "#tendencia"],
            )
        )

    return fallbacks


# ── LLM Callers — Stage 1 ─────────────────────────────────────────────────────


def _call_groq(
    transcript: str,
    max_clips: int,
    model: str,
    api_key: str,
    content_type: str = "general",
    video_title: str = "Video original",
    video_channel: str = "Canal de origen",
    audio_peaks_context: str = "",
) -> list[ClipCandidate]:
    """Call the Groq API for Stage 1 clip detection and parse the response."""
    from groq import Groq

    client = Groq(api_key=api_key)
    criteria = CONTENT_TYPE_PROMPTS.get(content_type, CONTENT_TYPE_PROMPTS["general"])
    prompt = USER_PROMPT_TEMPLATE.format(
        max_clips=max_clips,
        content_criteria=criteria,
        transcript=transcript,
        video_title=video_title or "Video original",
        video_channel=video_channel or "Canal de origen",
        audio_peaks_context=audio_peaks_context or "",
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
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
    video_title: str = "Video original",
    video_channel: str = "Canal de origen",
    audio_peaks_context: str = "",
) -> list[ClipCandidate]:
    """Call the Google Gemini API for Stage 1 clip detection and parse the response."""
    import google.generativeai as genai

    genai.configure(api_key=api_key)  # pyright: ignore[reportPrivateImportUsage]
    gem = genai.GenerativeModel(  # pyright: ignore[reportPrivateImportUsage]
        model_name=model,
        system_instruction=SYSTEM_PROMPT,
    )

    criteria = CONTENT_TYPE_PROMPTS.get(content_type, CONTENT_TYPE_PROMPTS["general"])
    prompt = USER_PROMPT_TEMPLATE.format(
        max_clips=max_clips,
        content_criteria=criteria,
        transcript=transcript,
        video_title=video_title or "Video original",
        video_channel=video_channel or "Canal de origen",
        audio_peaks_context=audio_peaks_context or "",
    )

    response = gem.generate_content(
        prompt,
        generation_config={
            "temperature": 0.2,
            "max_output_tokens": 4096,
            "response_mime_type": "application/json",
        },
    )

    raw = _extract_json(response.text)
    return LLMClipsResponse(**raw).clips


# ── LLM Callers — Stage 2 ─────────────────────────────────────────────────────


def _call_groq_stage2(
    transcript: str,
    model: str,
    api_key: str,
    video_title: str = "Video original",
    video_channel: str = "Canal de origen",
    core_idea: str = "",
    surface_topic: str = "",
    start_time: str = "00:00",
    end_time: str = "00:00",
) -> LLMSocialContentResponse:
    """Call the Groq API for Stage 2 social content analysis of a single clip."""
    from groq import Groq

    client = Groq(api_key=api_key)
    prompt = STAGE2_USER_PROMPT_TEMPLATE.format(
        video_title=video_title or "Video original",
        video_channel=video_channel or "Canal de origen",
        core_idea=core_idea or "(pendiente de análisis)",
        surface_topic=surface_topic or "(pendiente de análisis)",
        start_time=start_time,
        end_time=end_time,
        transcript=transcript,
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": STAGE2_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=2048,
    )

    content = response.choices[0].message.content or ""
    raw = _extract_json(content)
    return LLMSocialContentResponse(**raw)


def _call_gemini_stage2(
    transcript: str,
    model: str,
    api_key: str,
    video_title: str = "Video original",
    video_channel: str = "Canal de origen",
    core_idea: str = "",
    surface_topic: str = "",
    start_time: str = "00:00",
    end_time: str = "00:00",
) -> LLMSocialContentResponse:
    """Call the Gemini API for Stage 2 social content analysis of a single clip."""
    import google.generativeai as genai

    genai.configure(api_key=api_key)  # pyright: ignore[reportPrivateImportUsage]
    gem = genai.GenerativeModel(  # pyright: ignore[reportPrivateImportUsage]
        model_name=model,
        system_instruction=STAGE2_SYSTEM_PROMPT,
    )

    prompt = STAGE2_USER_PROMPT_TEMPLATE.format(
        video_title=video_title or "Video original",
        video_channel=video_channel or "Canal de origen",
        core_idea=core_idea or "(pendiente de análisis)",
        surface_topic=surface_topic or "(pendiente de análisis)",
        start_time=start_time,
        end_time=end_time,
        transcript=transcript,
    )

    response = gem.generate_content(
        prompt,
        generation_config={
            "temperature": 0.2,
            "max_output_tokens": 2048,
            "response_mime_type": "application/json",
        },
    )

    raw = _extract_json(response.text)
    return LLMSocialContentResponse(**raw)


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


MIN_CLIP_DURATION: float = 20.0
MAX_CLIP_DURATION: float = 120.0


def _validate_and_sanitize_clips(
    clips: list[ClipCandidate],
    segments: list[TranscriptSegment] | None = None,
) -> list[ClipCandidate]:
    """
    Reject invalid ranges and explicitly incomplete narratives.
    Duration alone cannot justify adding unrelated transcript seconds.
    """
    sanitized: list[ClipCandidate] = []
    max_video_time = segments[-1].end if segments else float("inf")

    for c in clips:
        # Check inverted timestamps
        if c.start_seconds > c.end_seconds:
            c.start_seconds, c.end_seconds = c.end_seconds, c.start_seconds

        dur = c.end_seconds - c.start_seconds

        if c.context_complete is False:
            continue
        if c.start_seconds < 0 or c.end_seconds > max_video_time:
            continue

        # Only accept clips meeting the minimum duration
        if dur >= MIN_CLIP_DURATION and dur <= MAX_CLIP_DURATION:
            sanitized.append(c)

    return sanitized


def to_first_person_reflection(reason: str, title: str = "") -> str:
    """Transform editorial or analyst reasons into a genuine first-person tactical reflection."""
    r = reason.strip()
    if not r:
        return "Para mí, la clave está en no quedarse solo en la teoría y aplicar esto con método para ver resultados tangibles."

    # Check if already written in first person
    if re.search(r"\b(yo|mi\b|mis\b|creo|siento|he aprendido|pienso|para m[ií]|me di cuenta|me hizo|siempre he)\b", r, re.IGNORECASE):
        return r

    # Strip editorial meta-analysis endings
    r_clean = re.sub(
        r",?\s*(?:generando|lo que genera|ideal para|lo que hace que|haciendo que|dejando una lección|con alto potencial|creando identificaci[oó]n|para captar).*$",
        "",
        r,
        flags=re.IGNORECASE,
    ).strip().rstrip(".")

    # Remove leading third person verb if present
    opener_match = re.match(
        r"^(?:Expone|Muestra|Explica|Enseña|Aborda|Destaca|Describe|Detalla|Presenta|Revela|Refleja|Demuestra|Ofrece)\s+(.*)$",
        r_clean,
        re.IGNORECASE,
    )
    rest = opener_match.group(1).strip() if opener_match else r_clean
    formatted_rest = (rest[0].lower() + rest[1:]) if len(rest) > 1 else rest

    if re.search(r"^(?:un|una|el|la)\s+(?:dolor|problema|error|riesgo|caos|falla|descuadre)", formatted_rest, re.IGNORECASE):
        return f"Para mí, esto toca un punto crítico: {formatted_rest}. Si no atacas la raíz de esto a tiempo, terminas perdiendo recursos valiosos y frenando el crecimiento de tu operación."

    if re.search(r"^(?:un|una|el|la)\s+(?:cambio|giro|oportunidad|lecci[oó]n|método|forma|estrategia|hack|secreto)", formatted_rest, re.IGNORECASE):
        return f"Para mí, el verdadero valor de este momento es {formatted_rest}. Aplicar este enfoque en la práctica te ahorra semanas de ensayo y error, y eleva la calidad de tus resultados."

    return f"Mi conclusión sobre esto es directa: {formatted_rest}. Tener claridad sobre este principio y aplicarlo con método es lo que realmente marca la diferencia en los resultados."


def ensure_caption_attribution(
    clip: ClipCandidate,
    video_title: str | None = None,
    video_channel: str | None = None,
) -> None:
    """Ensure that the clip's caption has a reflection and mentions the source video and channel."""
    text = (clip.caption or clip.title or "").strip()
    has_reflection = bool(re.search(r'(?:^|\s)(?:💡\s*)?reflexi[oó]n:', text, re.IGNORECASE))
    has_video = bool(re.search(r'(?:^|\n)\s*📌\s*video:', text, re.IGNORECASE))
    has_channel = bool(re.search(r'(?:^|\n)\s*🎙\s*canal:', text, re.IGNORECASE))

    blocks: list[str] = [text] if text else []

    if not has_reflection and clip.reason:
        fp_reflection = to_first_person_reflection(clip.reason, clip.title)
        blocks.append(f"💡 Reflexión: {fp_reflection}")

    if not text or (not text.endswith("?") and not text.endswith("👇") and "opinas" not in text.lower() and "¿" not in text):
        blocks.append("¿Qué opinas tú de esto? ¡Déjamelo saber en los comentarios! 👇")

    source_lines: list[str] = []
    if not has_video and video_title:
        source_lines.append(f"📌 Video: {video_title.strip()}")
    if not has_channel and video_channel:
        source_lines.append(f"🎙 Canal: {video_channel.strip()}")

    if source_lines:
        blocks.append("\n".join(source_lines))

    clip.caption = "\n\n".join(blocks).strip()


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
    video_title: str | None = None,
    video_channel: str | None = None,
    audio_peaks: list[dict[str, Any]] | None = None,
) -> list[ClipCandidate]:
    """
    Analyze transcript segments and return the top viral clip candidates.

    Args:
        segments: Whisper transcript segments with timestamps.
        provider: 'groq' or 'gemini'.
        api_key: API key for the chosen provider.
        model: Specific model name, or None to use the provider default.
        max_clips: Maximum clips to return in total.
        content_type: Target niche ('irl_calle', 'politica', 'entrevista', 'streaming', 'educativo', 'comedia', 'vlog', 'general').
        progress_callback: Optional fn(current_chunk, total_chunks, error_msg).
        video_title: Source video title to provide context and attribution.
        video_channel: Source video channel name to provide context and attribution.
        audio_peaks: Optional detected acoustic volume spikes (shouts, laughter, noise).

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

    v_title = (video_title or "Video original").strip()
    v_chan = (video_channel or "Canal de origen").strip()

    all_clips: list[ClipCandidate] = []

    for i, chunk in enumerate(chunks, 1):
        error_msg: str | None = None
        start_s = chunk[0].start if chunk else 0.0
        end_s = chunk[-1].end if chunk else 0.0
        time_range = f"{int(start_s // 60):02d}:{int(start_s % 60):02d} - {int(end_s // 60):02d}:{int(end_s % 60):02d}"

        # Context of audio peaks within this chunk's time window (+/- 5s)
        chunk_peaks = [
            p for p in (audio_peaks or [])
            if not (end_s + 5.0 < p["start"] or start_s - 5.0 > p["end"])
        ]
        peaks_context = format_audio_peaks_for_prompt(chunk_peaks)

        try:
            transcript_text = format_segments(chunk)
            chunk_clips = caller(
                transcript_text,
                clips_per_chunk,
                model,
                api_key,
                content_type=content_type,
                video_title=v_title,
                video_channel=v_chan,
                audio_peaks_context=peaks_context,
            )

            # Reconcile any relative timestamps from LLM:
            for c in chunk_clips:
                if start_s > 90.0 and c.start_seconds < (start_s - 45.0):
                    if (start_s + c.start_seconds) <= (end_s + 45.0):
                        c.start_seconds = round(start_s + c.start_seconds, 1)
                        c.end_seconds = round(start_s + c.end_seconds, 1)

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

    # Correlate detected clips with audio peaks to boost score and mark high-intensity spikes
    if audio_peaks:
        for c in all_clips:
            matched_peak = correlate_clip_with_peaks(c.start_seconds, c.end_seconds, audio_peaks)
            if matched_peak:
                spike_note = f" (Volumen acústico {matched_peak['intensity']}; no implica mayor calidad narrativa)"
                if "volumen acústico" not in c.reason.lower():
                    c.reason = f"{c.reason}{spike_note}"

    # Sanitize durations, deduplicate, sort, and limit
    all_clips = _validate_and_sanitize_clips(all_clips, segments)
    all_clips = _deduplicate(all_clips)
    all_clips.sort(key=lambda c: c.score, reverse=True)

    # Return fewer (or zero) candidates rather than padding with arbitrary slices.

    # Ensure all clip captions have the complete 4-part post description
    for c in all_clips:
        ensure_caption_attribution(c, video_title=video_title, video_channel=video_channel)

    return all_clips[:max_clips]


# ── Stage 2: Public Enrichment API ────────────────────────────────────────────


def get_clip_segments(
    clip: ClipCandidate,
    all_segments: list[TranscriptSegment],
    context_seconds: float = 10.0,
) -> list[TranscriptSegment]:
    """
    Extract transcript segments that fall within a clip's time window,
    with optional context padding before and after.
    """
    start = max(0.0, clip.start_seconds - context_seconds)
    end = clip.end_seconds + context_seconds
    return [s for s in all_segments if s.end > start and s.start < end]


def normalize_evidence(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold()))


def strict_clip_segments(clip, all_segments):
    """Use word timing at boundaries; otherwise exclude partially covered text."""
    selected = []
    for segment in all_segments:
        if segment.end <= clip.start_seconds or segment.start >= clip.end_seconds:
            continue
        if segment.words:
            words = [w for w in segment.words if
                     float(w["start"]) >= clip.start_seconds and float(w["end"]) <= clip.end_seconds]
            if words:
                selected.append(TranscriptSegment(
                    text=" ".join(str(w["word"]).strip() for w in words),
                    start=float(words[0]["start"]), end=float(words[-1]["end"]), words=words,
                ))
        elif segment.start >= clip.start_seconds and segment.end <= clip.end_seconds:
            selected.append(segment)
    return selected


def enrich_clip_social_content(
    clip: ClipCandidate,
    all_segments: list[TranscriptSegment],
    provider: LLMProvider,
    api_key: str,
    model: str | None = None,
    video_title: str | None = None,
    video_channel: str | None = None,
    context_seconds: float = 10.0,
) -> ClipCandidate:
    """
    Stage 2: Analyze a single clip's transcript and generate optimized social content.

    Uses only transcript evidence inside the clip boundaries to find the
    most interesting angle, generate hook candidates, select the winner, and produce
    a concrete social description.

    Mutates the clip in place and returns it.

    Args:
        clip:             The ClipCandidate to enrich (mutated in place).
        all_segments:     Full transcript segments of the video.
        provider:         'groq' or 'gemini'.
        api_key:          API key for the chosen provider.
        model:            Specific model name, or None for provider default.
        video_title:      Original video title for context and attribution.
        video_channel:    Original video channel for context and attribution.
        context_seconds:  Retained for compatibility; outside context is not used for metadata.

    Returns:
        The same ClipCandidate, with Stage 2 fields populated.
    """
    # Resolve model
    if model is None:
        model = GROQ_MODELS["default"] if provider == "groq" else GEMINI_MODELS["default"]

    v_title = (video_title or "Video original").strip()
    v_chan = (video_channel or "Canal de origen").strip()

    # Editorial metadata must never borrow dialogue outside the exported clip.
    # context_seconds is retained for API compatibility, but is not evidence.
    clip_segs = strict_clip_segments(clip, all_segments)
    if not clip_segs:
        raise ValueError("No hay transcripción verificable dentro del intervalo del clip.")

    transcript_text = format_segments(clip_segs)
    start_time = _fmt(clip.start_seconds)
    end_time = _fmt(clip.end_seconds)

    # Call Stage 2 LLM
    caller2 = _call_groq_stage2 if provider == "groq" else _call_gemini_stage2
    result = caller2(
        transcript=transcript_text,
        model=model,
        api_key=api_key,
        video_title=v_title,
        video_channel=v_chan,
        core_idea="Derivar únicamente de la transcripción del intervalo.",
        surface_topic="Derivar únicamente de la transcripción del intervalo.",
        start_time=start_time,
        end_time=end_time,
    )

    evidence = normalize_evidence(" ".join(s.text for s in clip_segs))
    quote = normalize_evidence(result.quote or "")
    if not quote or quote not in evidence:
        raise ValueError("La cita generada no aparece en el intervalo del clip. No se guardó el título.")

    # Apply Stage 2 results to clip
    clip.core_idea = result.core_idea
    clip.surface_topic = result.surface_topic
    clip.hidden_angle = result.hidden_angle
    clip.hook = result.hook
    clip.alternative_hooks = result.alternative_hooks
    clip.quote = result.quote
    clip.social_description = result.social_description
    clip.engagement_question = result.engagement_question
    clip.social_score = result.social_score
    clip.stage2_done = True

    # Update hashtags if Stage 2 provides them (more specific)
    if result.hashtags:
        clip.hashtags = result.hashtags

    # Promote hook → title (backward compat: title field always holds best hook)
    clip.title = result.hook

    # Promote social_description → caption with attribution check
    if result.social_description:
        clip.caption = result.social_description
        # Ensure source attribution is present
        ensure_caption_attribution(clip, video_title=video_title, video_channel=video_channel)

    return clip


def generate_more_clips_for_video(
    video_id: int,
    target_count: int = 6,
    provider: str | None = None,
    model: str | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    """
    Generate additional viral clips for an existing video by analyzing parts of
    the transcript that have not yet been selected (or have minimal coverage).
    Avoids duplicating or overlapping existing clips.
    """
    import os
    import json
    import concurrent.futures
    from pathlib import Path
    from sqlmodel import Session, col, select
    from clipfinder.db import engine
    from clipfinder.models import Video, Clip, ClipStatus, TranscriptSegment, ClipCandidate
    from clipfinder.downloader import get_source_id

    with Session(engine) as session:
        video = session.get(Video, video_id)
        if not video:
            raise ValueError(f"Video con ID {video_id} no fue encontrado.")

        existing_clips = session.exec(
            select(Clip).where(Clip.video_id == video_id)
        ).all()
        existing_ranges = [(c.start_seconds, c.end_seconds) for c in existing_clips]

        source = video.source_url or video.source_path or ""
        source_id = get_source_id(source)
        transcript_file = Path("outputs") / source_id / "transcript.json"
        if not transcript_file.exists():
            for p in Path("outputs").glob(f"*{source_id}*/transcript.json"):
                transcript_file = p
                break

        if not transcript_file.exists():
            raise FileNotFoundError(
                f"No se encontró el archivo de transcripción para el video {video_id}. "
                "Es necesario que la transcripción esté disponible en outputs."
            )

        raw_segs = json.loads(transcript_file.read_text(encoding="utf-8"))
        segments = [TranscriptSegment(**x) for x in raw_segs]
        if not segments:
            raise ValueError("La transcripción está vacía.")

        # Resolve provider & API key
        chosen_provider: LLMProvider = (provider or video.provider or "gemini").lower()  # type: ignore
        if chosen_provider not in ("groq", "gemini"):
            chosen_provider = "gemini"

        env_key = "GROQ_API_KEY" if chosen_provider == "groq" else "GEMINI_API_KEY"
        api_key = os.getenv(env_key)
        if not api_key:
            raise ValueError(f"Falta la clave {env_key} en el entorno (.env).")

        if not model:
            model = GROQ_MODELS["default"] if chosen_provider == "groq" else GEMINI_MODELS["default"]

        chosen_content_type = content_type or (video.cliente if video.cliente in CONTENT_TYPE_PROMPTS else "general")
        if chosen_content_type not in CONTENT_TYPE_PROMPTS:
            chosen_content_type = "general"

        chunks = chunk_segments(segments)
        if not chunks:
            raise ValueError("No se pudieron generar bloques de transcripción.")

        # Measure coverage of existing clips in each chunk
        def chunk_coverage(chunk: list[TranscriptSegment]) -> float:
            c_start = chunk[0].start
            c_end = chunk[-1].end
            cov = 0.0
            for s, e in existing_ranges:
                o_start = max(s, c_start)
                o_end = min(e, c_end)
                if o_end > o_start:
                    cov += (o_end - o_start)
            return cov

        scored_chunks = [(i, c, chunk_coverage(c)) for i, c in enumerate(chunks)]
        zero_cov = [sc for sc in scored_chunks if sc[2] == 0.0]
        low_cov = [sc for sc in scored_chunks if sc[2] > 0.0]
        low_cov.sort(key=lambda x: x[2])

        # How many chunks to analyze to get target_count clips
        # Each chunk asks for ~2 clips
        chunks_needed = max(2, min(len(chunks), (target_count + 1) // 2 + 1))

        selected_items = []
        if len(zero_cov) >= chunks_needed:
            # Distribute across zero_cov by original chunk index
            zero_cov.sort(key=lambda x: x[0])
            step = max(1, len(zero_cov) // chunks_needed)
            selected_items = [zero_cov[i * step] for i in range(chunks_needed)]
        else:
            selected_items = list(zero_cov)
            remaining = chunks_needed - len(selected_items)
            selected_items.extend(low_cov[:remaining])

        selected_items.sort(key=lambda x: x[0])

        caller = _call_groq if chosen_provider == "groq" else _call_gemini
        v_title = (video.title or "Video original").strip()
        v_chan = (video.channel or "Canal de origen").strip()

        def process_chunk(item: tuple[int, list[TranscriptSegment], float]) -> list[ClipCandidate]:
            idx, chunk, _ = item
            c_start = chunk[0].start
            c_end = chunk[-1].end
            transcript_text = format_segments(chunk)

            try:
                found = caller(
                    transcript=transcript_text,
                    max_clips=2 if target_count <= 6 else 3,
                    model=model,
                    api_key=api_key,
                    content_type=chosen_content_type,
                    video_title=v_title,
                    video_channel=v_chan,
                )
                for c in found:
                    if c_start > 90.0 and c.start_seconds < (c_start - 45.0):
                        if (c_start + c.start_seconds) <= (c_end + 45.0):
                            c.start_seconds = round(c_start + c.start_seconds, 1)
                            c.end_seconds = round(c_start + c.end_seconds, 1)
                return found
            except Exception:
                return []

        raw_candidates: list[ClipCandidate] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(selected_items), 5)) as pool:
            for res in pool.map(process_chunk, selected_items):
                raw_candidates.extend(res)

        # Validate and deduplicate candidates against each other
        valid_candidates = _validate_and_sanitize_clips(raw_candidates, segments)
        valid_candidates = _deduplicate(valid_candidates)

        # Strict filter against existing clips in DB
        strictly_new: list[ClipCandidate] = []
        for cand in valid_candidates:
            has_collision = False
            cand_dur = cand.end_seconds - cand.start_seconds
            if cand_dur <= 0:
                continue
            for ex_s, ex_e in existing_ranges:
                ov_s = max(cand.start_seconds, ex_s)
                ov_e = min(cand.end_seconds, ex_e)
                if ov_e > ov_s:
                    ov_len = ov_e - ov_s
                    # If overlaps more than 25% of candidate or more than 15s
                    if (ov_len / cand_dur) > 0.25 or ov_len > 15.0:
                        has_collision = True
                        break
            if not has_collision:
                strictly_new.append(cand)

        strictly_new.sort(key=lambda c: c.score, reverse=True)
        final_new = strictly_new[:target_count]

        # Ensure captions have reflection and attribution
        for c in final_new:
            ensure_caption_attribution(c, video_title=video.title, video_channel=video.channel)

        # Persist new clips to SQLite database
        saved_db_clips: list[Clip] = []
        for c in final_new:
            hashtags_val = c.hashtags_str if hasattr(c, "hashtags_str") else (
                ", ".join(c.hashtags) if isinstance(c.hashtags, list) else str(c.hashtags or "")
            )
            db_clip = Clip(
                video_id=video_id,
                start_seconds=c.start_seconds,
                end_seconds=c.end_seconds,
                title=c.title,
                reason=c.reason,
                score=c.score,
                status=ClipStatus.prospecto,
                caption=c.caption,
                hashtags=hashtags_val,
                core_idea=c.core_idea,
                surface_topic=c.surface_topic,
                stage2_done=False,
            )
            session.add(db_clip)
            saved_db_clips.append(db_clip)

        session.commit()
        for sc in saved_db_clips:
            session.refresh(sc)

        # Fetch all clips in DB for this video
        all_clips = session.exec(
            select(Clip).where(Clip.video_id == video_id).order_by(col(Clip.score).desc())
        ).all()

        # Update clips.json on disk if directory exists
        try:
            clips_json_path = Path("outputs") / source_id / "clips.json"
            if clips_json_path.parent.exists():
                disk_clips_data = [
                    {
                        "start_seconds": cl.start_seconds,
                        "end_seconds": cl.end_seconds,
                        "title": cl.title,
                        "reason": cl.reason,
                        "score": cl.score,
                        "caption": cl.caption,
                        "hashtags": cl.hashtags,
                    }
                    for cl in all_clips
                ]
                clips_payload = {
                    "video_source": video.source_url or video.source_path or "",
                    "duration_seconds": video.duration_seconds,
                    "clips": disk_clips_data,
                }
                clips_json_path.write_text(json.dumps(clips_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

        def format_clip(c: Clip) -> dict[str, Any]:
            d = c.model_dump()
            if isinstance(d.get("alternative_hooks"), str):
                try:
                    d["alternative_hooks"] = json.loads(d["alternative_hooks"])
                except Exception:
                    d["alternative_hooks"] = []
            d["video_title"] = video.title
            d["video_channel"] = video.channel
            d["video_source_url"] = video.source_url or video.source_path
            return d

        return {
            "success": True,
            "new_clips_count": len(saved_db_clips),
            "total_clips_count": len(all_clips),
            "new_clips": [format_clip(c) for c in saved_db_clips],
            "all_clips": [format_clip(c) for c in all_clips],
        }


