# Módulo Música

Abre `http://localhost:4030/music`, o selecciona **Música** en la navegación principal. Inicia los servicios con el flujo habitual de `start.sh`.

1. Pega un enlace de YouTube de un video de hasta 30 minutos.
2. Selecciona idioma original, pista de subtítulos y duración sugerida de los clips.
3. Analiza la canción. La opción instrumental omite el reconocimiento de letra.
4. Escucha las sugerencias, ajusta inicio/fin y revisa el texto original y la traducción. Puedes añadir/eliminar frases y editar sus tiempos.
5. Guarda la letra o exporta directamente. La exportación guarda los cambios y produce un MP4 con subtítulos incrustados y archivos SRT para las pistas disponibles.

**Canción completa** selecciona todo el video. **Escuchar selección** reproduce únicamente el intervalo. La línea de energía permite explorar libremente la canción. Los enlaces de descarga corresponden a la última exportación, aunque después cambies los ajustes.

## Configuración

- FFmpeg y FFprobe deben estar en el PATH del servidor. FFmpeg necesita el filtro `ass`/libass y los codificadores `libx264` y `aac`.
- La transcripción automática utiliza Groq si está configurado `GROQ_API_KEY`; en caso contrario usa Whisper local. La primera ejecución local puede descargar el modelo.
- La traducción requiere `GROQ_API_KEY` o `GEMINI_API_KEY`, según el proveedor del proyecto. El modelo Groq se puede configurar con `MUSIC_TRANSLATION_MODEL`; por defecto es `llama-3.3-70b-versatile`.
- Las opciones de sesión `CLIPFINDER_YOUTUBE_COOKIES_BROWSER` y `CLIPFINDER_YOUTUBE_COOKIES_FILE` se aplican a la descarga musical. YouTube puede bloquear videos o pedir una sesión válida.
- El módulo musical transcribe directamente el audio descargado con tiempos de palabra. Elegir Whisper local evita una segunda consulta de subtítulos a YouTube, que podía quedar esperando otra verificación de sesión.

## Persistencia y límites

Los proyectos se guardan en `outputs/music/<id>/`, separados del historial de conversaciones. Incluyen fuente, vista previa, audio de análisis, letra, traducción, señales y exportaciones. Pueden abrirse desde **Mis canciones** o mediante `/music?project=<id>`.

El servidor ejecuta trabajos en hilos, con exclusión por proyecto. Un reinicio interrumpe los trabajos en curso; los resultados completados permanecen disponibles. El MVP está orientado al servidor local con un solo proceso, igual que el flujo existente. No se configura una cola distribuida.

El análisis combina energía relativa, ataques espectrales y cambios de energía; la puntuación sirve para comparar propuestas de esa canción. No garantiza detección exacta de coros, drops ni viralidad. No utiliza separación de voz ni cambia el cantante. La letra reconocida puede tener errores, especialmente en mezclas densas: revísala antes de exportar.

La traducción se sincroniza por frases cortas. Los tiempos de palabras originales no se usan como karaoke español. El audio exportado conserva sus canales y no recibe normalización de voz, aunque se recodifica a AAC. El video se exporta con H.264 CRF 18 y el encuadre seleccionado, incluido 9:16. La vista previa de subtítulos aproxima el render de libass y puede variar en tipografía o salto de línea según las fuentes instaladas.

## Verificación

```sh
.venv/bin/python -m unittest discover -s tests -p test_music.py -v
web/node_modules/.bin/tsc --noEmit --project web/tsconfig.json
```

Las pruebas no descargan contenido de YouTube ni gastan cuotas de IA. Usan audio/video sintético, adaptadores simulados para servicios y una exportación real con FFmpeg que comprueba duración, subtítulos relativos al recorte y audio estéreo.

## Clips musicales verticales (actualización)

El editor abre por defecto en **9:16** y exporta a **1080 × 1920**. Puedes llenar la pantalla con recorte y ajustar horizontalmente el encuadre, conservar el video completo dentro de un lienzo vertical o usar su formato original.

Los subtítulos se muestran en bloques de 3 a 8 palabras (cinco por defecto), con tipografías Cine/Avenir Next, Editorial/Georgia cursiva o Impacto/Arial. La actualización de estilo central fija los subtítulos en mayúsculas. Vista previa, ASS y SRT comparten el mismo generador de bloques: el recorte conserva su posición temporal y no redistribuye toda una estrofa en el intervalo recortado.

Las transcripciones nuevas conservan tiempos de palabra y se dividen antes de traducir. El español se sincroniza por frases cortas, sin presentar los tiempos ingleses como una alineación palabra por palabra del español. En subtítulos antiguos sin tiempos por palabra, los bloques dentro de una frase larga usan distribución temporal estimada y el editor lo indica.

**Mejorar sincronía** vuelve a reconocer el audio con Whisper, omitiendo los subtítulos largos de YouTube, y traduce las frases nuevas si corresponde. Esta acción reemplaza la letra editada y pide confirmación dentro del editor.

**Buscar coros y frases con IA** analiza la letra guardada mediante el proveedor del proyecto. El servidor construye tiempos y citas a partir de identificadores de frases existentes: el modelo no puede inventar sus propios timestamps. Además se buscan secuencias de letra repetida como indicio de posibles coros. Los filtros son **Posibles coros**, **Me identifica**, **Clímax** y **Energía**. Los coros son propuestas para revisar escuchando, no una segmentación musical garantizada. Si falla la IA, se conservan las propuestas de repetición y de energía.

La tipografía de vista previa y render depende de las fuentes instaladas en el equipo; las familias se seleccionan de una lista cerrada. Las exportaciones guardan la configuración elegida para recuperarla al abrir el proyecto.

Pruebas específicas adicionales:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_music*.py' -v
```

## Fondo propio y estilo central

Los subtítulos se exportan siempre en MAYÚSCULAS y centrados horizontal y verticalmente. Se mantiene la selección de tipografía, tamaño, color y palabras por bloque.

**Cargar imagen o GIF** reemplaza la escena original por el archivo del usuario, conservando el audio de la canción y los subtítulos. Se admite JPG, PNG, WebP estático y GIF animado de hasta 20 MB y 20 megapíxeles. Los GIFs se repiten durante la exportación; se admiten hasta 600 cuadros. La vista previa anima el GIF independientemente de la pausa del audio.

**Cambiar imagen o GIF** sustituye el fondo y **Volver al video original** restaura la escena de la canción. El fondo elegido se guarda con la configuración al exportar. Los archivos cargados permanecen en `outputs/music_library/`.

La vista no ofrece búsquedas de imágenes, enlaces a Pinterest/GIPHY, filtros temáticos ni fondos integrados. Los fondos de exportaciones anteriores siguen siendo legibles por compatibilidad, pero al abrir un proyecto que usaba una ilustración integrada el editor vuelve al video original.

El extra de instalación `.[web]` incluye Pillow para validar imágenes. La exportación utiliza FFmpeg y libass.

## Descargas bloqueadas por YouTube

Si YouTube solicita verificar la sesión, el análisis muestra dos acciones: **Reintentar descarga** (configuración habitual) y **Reintentar con mi sesión de Brave**. La segunda utiliza cookies del navegador exclusivamente para ese intento, tras la elección explícita del usuario. No modifica `.env` ni guarda esa elección para siguientes proyectos.

Abre primero el video en Brave con la sesión de YouTube iniciada. Si macOS solicita acceso al llavero, el usuario debe revisar y resolver ese permiso. El reintento no garantiza que YouTube levante el bloqueo; una verificación adicional o una limitación del servicio todavía puede impedir la descarga.

## Progreso y recuperación de la letra

La preparación del modelo y el reconocimiento del primer fragmento se muestran como etapas distintas. Durante la transcripción, la interfaz muestra el porcentaje real de audio procesado y el número de segmentos, además del avance global. La letra se guarda antes del análisis editorial y la traducción.

Si un análisis se interrumpe después de completar la descarga, **Reintentar descarga** reutiliza el audio guardado para continuar con la letra; no vuelve a descargar el video. Las transcripciones locales priorizan un modelo completo disponible en la caché antes de consultar la red.

Las sugerencias se limitan a un máximo de 4 clips por canción entre todas las categorías. Las frases breves se amplían con contexto hasta la duración elegida (30 segundos por defecto), con un mínimo de 20 segundos y preferencia por límites de frases cercanos. Se descartan propuestas con demasiado solapamiento; puede haber menos de 4 si no hay suficientes tramos distintos. Las canciones de menos de 20 segundos no generan sugerencias. Los recortes manuales siguen siendo editables. Esta selección también se aplica a los análisis guardados.

Cada sugerencia incluye una descripción para TikTok con un comentario casual de dos frases relacionado con ese intervalo y una línea visible con canción y artista, sin copiar la letra ni usar introducciones como «Yo opino». Los hashtags incluyen Lunalgia, artista y canción, más género cuando está identificado y tema del fragmento. Se puede editar antes de copiarla; la edición de la descripción es temporal en la página. No requiere otra llamada a un proveedor de IA. La vista previa y las nuevas exportaciones llevan «Lunalgia» arriba y el título de la canción abajo, con los subtítulos centrados. Estas marcas también se exportan sin subtítulos y al usar una imagen o GIF de fondo; los SRT contienen únicamente la letra.

La letra se procesa en cuatro etapas: transcripción original conservada, agrupación en frases con contexto, revisión del idioma original y traducción. Solo después se divide en subtítulos breves para presentación. Las correcciones no alteran el intervalo de cada frase; los tiempos de palabras originales se descartan cuando cambia el texto. La sincronización interna del español es estimada, no alineación forzada palabra por palabra.

La revisión con Gemini adjunta fragmentos del WAV local de hasta unos 45 segundos. Con Groq la revisión es textual por contexto y se identifica como tal. El revisor conserva frases inciertas y las marca para escuchar; las correcciones requieren confianza alta y una respuesta válida por ID. No reconstruye versos ausentes. Una falla conserva la letra previa y muestra un error recuperable. Se guarda `raw_transcription`, un respaldo anterior a la revisión, el historial antes/después y las dudas. Esto permite comparar sin perder la salida de Whisper.

Los nuevos análisis revisan antes de traducir. Para canciones guardadas, «Revisar letra y traducción» aplica el flujo sin volver a descargar ni transcribir el video. «Traducir al español» también revisa primero los proyectos antiguos que aún no tienen revisión. La operación reemplaza la letra de trabajo al terminar y conserva el respaldo. Se regeneran sugerencias para que sus citas e IDs correspondan a las nuevas frases.
