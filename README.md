# 🎬 ClipFinder

> **Detecta automáticamente los mejores momentos virales de un video largo.**  
> Transcripción local con Whisper + análisis con LLM → lista de timestamps listos para cortar en CapCut/Premiere.

---

## ¿Qué hace?

1. 📥 **Descarga** el audio de YouTube (o usa un archivo local)
2. 🎙️ **Transcribe** el audio con `faster-whisper` (corre 100% local)
3. 🧠 **Analiza** la transcripción con Groq (o Gemini) y detecta momentos virales
4. 📊 **Genera** un reporte en Markdown, JSON y CSV con timestamps y scores

**Etapa actual: solo detección** — no corta ni renderiza video.

---

## Requisitos

- Python 3.11+
- [ffmpeg](https://ffmpeg.org/download.html) instalado en el sistema
- API key de [Groq](https://console.groq.com/keys) o [Google Gemini](https://aistudio.google.com/app/apikey)

### Verificar ffmpeg

```bash
ffmpeg -version
```

Si no tienes ffmpeg en Mac:
```bash
brew install ffmpeg
```

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/clipfinder.git
cd clipfinder

# 2. Crear entorno virtual e instalar dependencias
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows

pip install -e .

# 3. Configurar API keys
cp .env.example .env
# Editar .env y agregar tu GROQ_API_KEY
```

---

## Uso

### Comando básico

```bash
# Analizar un video de YouTube
clipfinder analyze https://youtube.com/watch?v=dQw4w9WgXcQ

# Analizar un archivo local
clipfinder analyze /path/to/mi_podcast.mp4
```

### Opciones completas

```bash
clipfinder analyze URL_O_PATH [OPCIONES]

Opciones:
  -p, --provider TEXT          LLM provider: groq (default) | gemini
  -m, --model TEXT             Modelo LLM específico
  -w, --whisper-model TEXT     Modelo Whisper: tiny | base | small (default) | medium | large-v3
  -l, --language TEXT          Idioma del audio (ej: 'es', 'en'). Auto si se omite.
  -n, --max-clips INT          Máximo de clips a detectar (default: 12)
  -o, --output PATH            Directorio de salida
      --api-key TEXT           API key del proveedor (alternativa a .env)
      --skip-download          Saltar descarga si audio.wav ya existe
      --keep-audio             Conservar el archivo de audio
```

### Ejemplos

```bash
# Video en español, modelo mediano de Whisper, máximo 10 clips
clipfinder analyze https://youtu.be/... -l es -w medium -n 10

# Podcast local con Gemini
clipfinder analyze episodio.mp3 --provider gemini

# Re-analizar sin re-descargar (útil para iterar con distintos modelos)
clipfinder analyze https://youtu.be/... --skip-download

# Guardar audio para revisarlo después
clipfinder analyze https://youtu.be/... --keep-audio
```

---

## Salida

Los resultados se guardan en `outputs/<video_id>/`:

| Archivo | Descripción |
|---------|-------------|
| `report.md` | Reporte legible para el editor de video |
| `clips.json` | JSON estructurado con todos los datos |
| `clips.csv` | Tabla importable en Google Sheets / Excel |
| `transcript.json` | Transcripción completa raw de Whisper |

### Ejemplo de `report.md`

```markdown
### 1. La estadística que te cambia la perspectiva

| | |
|-|-|
| ⏱️ Inicio | `04:23` (263s) |
| ⏱️ Fin    | `05:47` (347s) |
| ⏳ Duración | 84s |
| 🔥 Score | 9/10 — ⭐⭐⭐⭐⭐⭐⭐⭐⭐☆ |
| 💡 Motivo | Dato contraintuitivo presentado con energía alta. Perfecto hook para Reels. |
```

---

## Modelos disponibles

### Groq (default)

| Modelo | Velocidad | Calidad | Uso recomendado |
|--------|-----------|---------|-----------------|
| `llama-3.1-8b-instant` | ⚡ Muy rápido | ★★★ | Pruebas rápidas |
| `llama-3.3-70b-versatile` | ★★★ Normal | ⭐⭐⭐⭐⭐ | **Default — mejor balance** |

### Whisper (local)

| Modelo | Tamaño | Velocidad CPU | Calidad |
|--------|--------|---------------|---------|
| `tiny` | 75 MB | ⚡⚡⚡ | ★★ |
| `base` | 145 MB | ⚡⚡ | ★★★ |
| `small` | 466 MB | ⚡ | ★★★★ **← default** |
| `medium` | 1.5 GB | Lento | ★★★★★ |
| `large-v3` | 3 GB | Muy lento | ★★★★★+ |

---

## Costos estimados (Etapa 1 — solo detección)

| Componente | Costo |
|------------|-------|
| Transcripción (faster-whisper local) | **$0** |
| Análisis LLM con Groq | ~$0.01-0.05 por video de 2h |
| **Total por video** | **< $0.05** |

---

## Roadmap

- [x] **Etapa 1:** Detección de momentos virales con timestamps ← _estamos aquí_
- [ ] **Etapa 2:** Corte automático con `ffmpeg-python` (formato 9:16)
- [ ] **Etapa 3:** Interfaz web con FastAPI + frontend
- [ ] **Etapa 4:** Cola de trabajos con Celery/Redis para múltiples clientes

---

## Estructura del proyecto

```
clipfinder/
├── clipfinder/
│   ├── __init__.py       # versión del paquete
│   ├── cli.py            # comandos typer (punto de entrada)
│   ├── downloader.py     # wrapper yt-dlp
│   ├── transcriber.py    # wrapper faster-whisper
│   ├── analyzer.py       # llamadas LLM + chunking + parsing
│   ├── models.py         # schemas pydantic
│   └── report.py         # genera JSON/MD/CSV
├── outputs/              # resultados (ignorado por git)
├── .env                  # tus API keys (ignorado por git)
├── .env.example          # template
├── pyproject.toml        # dependencias
└── README.md
```

---

## Licencia

MIT — úsalo para tus propios proyectos y contenido autorizado.

> ⚠️ Úsalo únicamente con contenido del que tienes derechos o permiso de uso.
> No está diseñado para descargar contenido de terceros sin autorización.
