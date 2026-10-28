# IA Smart

IA Smart y smart_track mantienen el recorte vertical y usan TalkNet para puntuar
la sincronía entre el audio y cada rostro. Podcast se elige explícitamente y
Blur BG se mantiene como formato separado.

Instalación desde la raíz del proyecto:

```sh
.venv/bin/python -m pip install -e '.[smart]'
.venv/bin/python -m clipfinder.setup_smart
```

Los pesos oficiales de TalkNet se guardan en outputs/models/talknet (no versionados).
CLIPFINDER_TALKNET_MODEL permite indicar otra ruta al mismo checkpoint.
El análisis usa CPU, agrega tiempo a la exportación y se ejecuta localmente.
Si faltan audio, modelo o rostros fiables, la exportación informa el problema;
no cambia silenciosamente a Blur BG. La estimación del hablante puede equivocarse
en doblajes, voces fuera de plano o caras muy pequeñas/de perfil.

Código del modelo y licencia: clipfinder/vendor/talknet.
