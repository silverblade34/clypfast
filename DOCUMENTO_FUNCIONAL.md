# ClipFinder — Documento Funcional (Fase Agencia / Uso Personal)

## 1. Alcance de esta fase

Producto de uso interno (una sola cuenta, sin multi-tenant, sin billing, sin planes).  
**Objetivo:** que Marcos pueda procesar el contenido de sus clientes de agencia con la mayor calidad y velocidad posible, sin depender de edición 100% manual.

### Fuera de alcance en esta fase (queda para fase SaaS futura):
- Autenticación multi-usuario
- Límites de uso / marca de agua condicional
- Cobros / facturación / suscripciones
- Despliegue en servidor cloud (se procesa localmente en Mac con aceleración M3 Pro)

---

## 2. Funcionalidades y Módulos Construidos

| Módulo | Función |
|---|---|
| `subtitles.py` | Extrae subtítulos oficiales de YouTube (`json3`, con timestamps por palabra) de forma instantánea (~1s). |
| `downloader.py` | Descarga audio en 16kHz mono cuando no hay subtítulos disponibles. |
| `groq_whisper.py` | Transcripción rápida en la nube vía Groq Whisper Large-v3-Turbo (~10s). |
| `transcriber.py` | Transcripción local de respaldo con `faster-whisper` optimizada para CPU/NEON del M3 Pro. |
| `analyzer.py` | Análisis de transcripción con LLM (`groq/compound` y Gemini 2.0 Flash) para detección de clips virales, copy y hashtags. |
| `models.py` | Modelos Pydantic con validación robusta y sanitización de scores. |
| `db.py` | Persistencia SQLite local (`outputs/clipfinder.db`) con histórico de videos y clips. |
| `video_processor.py` | Pipeline de renderizado vertical 9:16 con Smart Tracking (MediaPipe) y subtítulos animados estilo Hormozi. |
| `api.py` | Backend FastAPI con streaming SSE de progreso en tiempo real y endpoints de render. |
| `web/` | Dashboard Next.js (Dark Mode Glassmorphism) con reproductor sincronizado, selector de rubro e historial de clientes. |

---

## 3. Criterios de Viralidad por Tipo de Contenido (Selector de Rubro)

La definición de "viral" cambia radicalmente según el nicho. El selector de **Tipo de Contenido / Rubro** inyecta prompts especializados en el LLM de análisis:

| Rubro | Criterios clave de búsqueda en el LLM |
|---|---|
| **Política / Show de Opinión / Debate** (`politica`) | Declaraciones polémicas, acusaciones directas, momentos de tensión o confrontación entre panelistas, mención de figuras públicas y tono de escándalo. |
| **Streaming / Gaming / Reacciones** (`streaming`) | Reacciones exageradas (gritos, risas, shock), fails cómicos, jugadas clutch/comeback, picos de energía en la voz y momentos fuera de contexto. |
| **Entrevista / Podcast Reflexivo** (`entrevista`) | Ganchos intelectuales, reflexiones profundas, datos sorprendentes, historias emotivas y remates inspiradores con coherencia narrativa. |
| **Educativo / Negocios / Charlas** (`educativo`) | Consejos prácticos, métodos paso a paso, formato "Mito vs Realidad", datos contraintuitivos y estadísticas impactantes. |
| **Comedia / Entretenimiento** (`comedia`) | Remates de chiste (punchlines), situaciones incómodas, quiebres de tono inesperados, situaciones absurdas y humor natural. |
| **General / Mixto** (`general`) | Criterios balanceados: gancho en primeros 3s, punch lines, datos llamativos, humor y anécdotas autocontenidas. |

---

## 4. Regla de Oro Anti-0-Clips (Fallback Automático)

Para garantizar la confiabilidad de la herramienta en videos con formatos atípicos, silencios o modelos LLM compactos:
1. **Sanitización de Pydantic**: Se normalizan puntuaciones decimales del LLM (ej. `8.5` → `9`) evitando que una excepción silencie el análisis.
2. **Modelo Base Robusto**: Se estandarizó el modelo Groq a `groq/compound` (mayor capacidad de razonamiento que el modelo mini).
3. **Fallback Garantizado**: Si por alguna razón el LLM devuelve una lista vacía, el sistema genera automáticamente **los 3 mejores momentos disponibles** del video a partir de la distribución temporal del audio transcrito, permitiendo al usuario visualizarlos y decidir si los utiliza. **Nunca se devuelve 0 clips si hay contenido transcrito.**

---

## 5. Pipeline de Render Vertical 9:16 y Subtítulos Hormozi

1. **Smart Tracking Facial (MediaPipe BlazeFace)**:
   - Detección de rostros fotograma a fotograma.
   - Suavizado exponencial del centroide horizontal ($X_{smooth} = \alpha X_{new} + (1-\alpha) X_{prev}$).
   - Encuadre vertical cinemático 1080x1920 enfocado en el interlocutor activo.
2. **Subtítulos Animados Estilo Hormozi**:
   - Generación de archivo ASS con fuentes bold, bordes marcados y resaltado de palabras clave en amarillo brillante (`&H0022FFFF&`).
   - Sincronización precisa por palabra obtenida de Whisper/YouTube Subtitles.
3. **Exportación con Aceleración Apple Silicon**:
   - Codificación vía `h264_videotoolbox` en macOS para renders ultra rápidos sin sobrecalentar el equipo.
