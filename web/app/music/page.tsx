"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Music2, Loader2, Play, Download, Plus, Save, Languages, AudioLines, Scissors, ImagePlus, Upload, Pause } from "lucide-react";
import styles from "./page.module.css";

type Line = { words?: { word: string; start: number; end: number }[]; id: number; start: number; end: number; original: string; spanish: string };
type Moment = { start: number; end: number; peak: number; score: number; reason: string; kind?: string; quote?: string; post_description?: string };
type Style = { mode: "original" | "spanish" | "bilingual" | "none"; font_size: number; margin: number; color: "white" | "yellow" | "cyan"; font: "Avenir Next" | "Georgia" | "Arial"; max_words: number; layout: "vertical_crop" | "vertical_fit" | "original"; crop_x: number; casing: "uppercase"; background_id: string | null };
type Project = {
  id: string; title: string; status: string; progress: number; step: string; duration: number;
  media_ready: boolean; aspect_ratio?: number; lyrics: Line[]; timeline: { time: number; energy: number; attack: number }[];
  moments: Moment[]; error_code?: string; error?: string; translation_error?: string; lyrics_error?: string; warnings: string[];
  review_version?: number; review_error?: string; review_method?: string;
  raw_transcription?: Line[];
  review_changes?: { id: number; start: number; before: string; after: string; evidence: string; reason: string }[];
  review_doubts?: { id: number; start: number; reason: string }[];
  insights_error?: string; insights_version?: number; editor_style?: Partial<Style>;
  request: { subtitle_mode: Style["mode"]; language?: string; provider?: string; engine?: string };
  export?: { id: string; status: string; error?: string; spanish_srt?: boolean };
};
type Background = { id: string; title: string; theme: string; kind: "image" | "gif"; origin: string };
type Summary = Pick<Project, "id" | "title" | "status" | "duration">;
const initialStyle: Style = { mode: "spanish", font_size: 58, margin: 300, color: "white", font: "Avenir Next", max_words: 5, layout: "vertical_crop", crop_x: 50, casing: "uppercase", background_id: null };
const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api/music/projects${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Revisa los campos y los tiempos ingresados.";
    throw new Error(detail);
  }
  return data;
}

function ClipPost({ description }: { description: string }) {
  const [text, setText] = useState(description);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => { setText(description); setCopied(false); }, [description]);
  return <div className={styles.clipPost}>
    <label>Descripción para TikTok<textarea aria-label="Descripción para TikTok" value={text} onChange={e => { setText(e.target.value); setCopied(false); }} rows={6} /></label>
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(""); }
      catch { setCopyError("Selecciona el texto y cópialo manualmente."); }
    }}>{copied ? "Copiado ✓" : "Copiar descripción"}</button>
    {copyError && <small role="status">{copyError}</small>}
  </div>;
}

export default function MusicPage() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [provider, setProvider] = useState("groq");
  const [engine, setEngine] = useState("auto");
  const [instrumental, setInstrumental] = useState(false);
  const [clipDuration, setClipDuration] = useState(30);
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [style, setStyle] = useState<Style>(initialStyle);
  const [range, setRange] = useState({ start: 0, end: 30 });
  const [cues, setCues] = useState<{ start: number; end: number; text: string; timing: string }[]>([]);
  const [estimated, setEstimated] = useState(false);
  const [captionError, setCaptionError] = useState("");
  const [momentFilter, setMomentFilter] = useState("all");
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [playing, setPlaying] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [polling, setPolling] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const previewEnd = useRef<number | null>(null);
  const busy = pending || polling || project?.status === "processing" || project?.status === "queued" || project?.export?.status === "processing";
  const activeCue = cues.find(cue => cue.start <= current && cue.end > current);
  const vertical = !!style.background_id || style.layout !== "original";
  const selectedBackground = backgrounds.find(b => b.id === style.background_id);
  const outputRatio = vertical ? 9 / 16 : project?.aspect_ratio || 16 / 9;
  const outputHeight = vertical ? 1920 : 1080;
  const filteredMoments = project?.moments.filter(m => momentFilter === "all" || (m.kind || "energy") === momentFilter) || [];

  useEffect(() => {
    if (!project?.id || !project.media_ready) { setCues([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/${project.id}/captions`, "POST", { lyrics: lines, style }).then(result => {
        if (!cancelled) { setCues(result.cues); setEstimated(result.estimated); setCaptionError(""); }
      }).catch(e => { if (!cancelled) { setCues([]); setCaptionError(e.message); } });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
    // Font and framing do not change cue timing; keep edits inexpensive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.media_ready, lines, style.mode, style.max_words, style.casing]);

  useEffect(() => {
    api("").then(setProjects).catch(e => setError(e.message));
    fetch("/api/music/library", { cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("No se pudo recuperar el nombre del fondo guardado.");
      setBackgrounds(await r.json());
    }).catch(e => setLibraryError(e.message));
  }, []);

  useEffect(() => {
    if (!project?.id || !polling) return;
    const id = project.id;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next: Project = await api(`/${id}`);
        if (disposed) return;
        setProject(next);
        const running = ["queued", "processing"].includes(next.status) || next.export?.status === "processing";
        if (!running) {
          setPolling(false);
          setLines(next.lyrics);
          setDirty(false);
          setRange(r => ({ start: Math.min(r.start, Math.max(0, next.duration - 1)), end: Math.min(r.end, next.duration) }));
          api("").then(setProjects).catch(() => {});
        } else timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!disposed) { setError((e as Error).message); timer = setTimeout(poll, 4000); }
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [project?.id, polling]);

  async function perform(action: () => Promise<void>) {
    setPending(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }

  async function openProject(id: string) {
    if (dirty && !window.confirm("Hay cambios de letra sin guardar. ¿Quieres abrir otro análisis?")) return;
    await perform(async () => {
      const data: Project = await api(`/${id}`);
      setProject(data); setLines(data.lyrics); setDirty(false);
      setProvider(data.request.provider || "groq"); setLanguage(data.request.language || "auto"); setEngine(data.request.engine || "auto");
      setRange({ start: 0, end: Math.min(data.duration || clipDuration, clipDuration) });
      setStyle({ ...initialStyle, ...data.editor_style, background_id: data.editor_style?.background_id?.startsWith("scene-") ? null : data.editor_style?.background_id || null, casing: "uppercase", mode: data.editor_style?.mode || data.request.subtitle_mode });
      setPolling(["processing", "queued"].includes(data.status) || data.export?.status === "processing");
      window.history.replaceState(null, "", `/music?project=${id}`);
    });
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project");
    if (id && /^[a-f0-9]{32}$/.test(id)) void openProject(id);
    // Restore a shared/reloaded project only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    await perform(async () => {
      if (dirty && !window.confirm("Hay cambios de letra sin guardar. ¿Quieres crear otro análisis?")) return;
      const result = await api("", "POST", { url, language, provider, engine, instrumental, clip_duration: clipDuration,
        subtitle_mode: instrumental ? "none" : style.mode });
      const data = await api(`/${result.id}`);
      setProject(data); setLines([]); setDirty(false); setRange({ start: 0, end: clipDuration }); setPolling(true);
      if (instrumental) setStyle(s => ({ ...s, mode: "none" }));
      window.history.replaceState(null, "", `/music?project=${result.id}`);
    });
  }

  async function save() {
    if (!project) return;
    await api(`/${project.id}/lyrics`, "PATCH", { lyrics: lines });
    setDirty(false);
  }

  function edit(id: number, values: Partial<Line>) {
    setLines(old => old.map(line => line.id === id ? { ...line, ...values, ...(values.original !== undefined || values.start !== undefined || values.end !== undefined ? { words: [] } : {}) } : line));
    setDirty(true);
  }

  function seek(start: number, end?: number) {
    previewEnd.current = end ?? null;
    if (video.current) { video.current.currentTime = start; void video.current.play().catch(() => {}); }
    setCurrent(start);
    if (end !== undefined) setRange({ start, end });
  }

  const file = (name: string) => `/api/music/projects/${project?.id}/files/${name}`;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/"><ArrowLeft size={17} /> Clypfast</Link>
        <span><Music2 size={18} /> Estudio de música</span>
        <a href="#history">Mis canciones</a>
      </header>
      <section className={styles.hero}>
        <span className={styles.eyebrow}><AudioLines size={16} /> MÚSICA · SUBTÍTULOS · CLIPS</span>
        <h1>Encuentra el momento.<br /><em>Haz que se entienda.</em></h1>
        <p>Convierte una canción de YouTube en fragmentos destacados, con letra original o subtítulos en español.</p>
      </section>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {notice && <div role="status" className={styles.notice}>{notice}</div>}
      <form className={styles.panel} onSubmit={e => { e.preventDefault(); void start(); }}>
        <label className={styles.urlLabel}>Enlace de YouTube
          <input type="url" required placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e => setUrl(e.target.value)} disabled={!!busy} />
        </label>
        <div className={styles.options}>
          <label>Idioma original<select value={language} onChange={e => setLanguage(e.target.value)} disabled={!!busy}>
            <option value="auto">Detectar automáticamente</option><option value="en">Inglés</option><option value="es">Español</option>
          </select></label>
          <label>Subtítulos<select value={style.mode} onChange={e => setStyle(s => ({ ...s, mode: e.target.value as Style["mode"] }))} disabled={!!busy}>
            <option value="spanish">Español</option><option value="original">Letra original</option><option value="bilingual">Original + español</option><option value="none">Sin subtítulos</option>
          </select></label>
          <label>Duración de clips<select value={clipDuration} onChange={e => setClipDuration(Number(e.target.value))} disabled={!!busy}>
            {[20, 30, 45, 60, 90].map(v => <option key={v} value={v}>{v} segundos</option>)}
          </select></label>
          <label>Traducción<select value={provider} onChange={e => setProvider(e.target.value)} disabled={!!busy}>
            <option value="groq">Groq</option><option value="gemini">Gemini</option>
          </select></label>
          <label>Transcripción<select value={engine} onChange={e => setEngine(e.target.value)} disabled={!!busy}>
            <option value="auto">Automática</option><option value="local">Whisper local</option><option value="groq">Groq Whisper</option>
          </select></label>
        </div>
        <div className={styles.actions}>
          <label className={styles.check}><input type="checkbox" checked={instrumental} onChange={e => setInstrumental(e.target.checked)} disabled={!!busy} /> Instrumental: analizar sin letra</label>
          <button className={styles.primary} disabled={!!busy} type="submit">{busy ? <Loader2 className={styles.spin} size={17} /> : <Music2 size={17} />} Analizar canción</button>
        </div>
        <p className={styles.hint}>Videos de hasta 30 minutos. El audio original se conserva. La traducción utiliza la clave del proveedor configurada en el servidor.</p>
      </form>
      {project && <section className={styles.workspace}>
        <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>TU ANÁLISIS</span><h2>{project.title}</h2></div><span>{time(project.duration)}</span></div>
        {(polling || project.status === "error") && <div className={styles.panel} aria-live="polite">
          <p>{project.export?.status === "processing" ? "Exportando video con subtítulos…" : project.step} {project.status !== "error" && project.export?.status !== "processing" && `${project.progress}%`}</p>
          <progress max={100} value={project.progress} />
          {project.error && <p className={styles.error}>{project.error_code === "youtube_session_required" || project.error.includes("YouTube bloqueó") ? "YouTube solicita verificar la sesión antes de descargar este video. Abre el enlace en Brave e inicia sesión en YouTube." : project.error}</p>}
          {project.status === "error" && <div>
            <div className={styles.actions}>
              <button disabled={!!busy} onClick={() => void perform(async () => {
                await api(`/${project.id}/retry`, "POST", {}); setPolling(true);
              })}>Reintentar descarga</button>
              {(project.error_code === "youtube_session_required" || project.error?.includes("YouTube bloqueó")) && <button className={styles.primary} disabled={!!busy} onClick={() => void perform(async () => {
                await api(`/${project.id}/retry`, "POST", { youtube_browser: "brave" }); setPolling(true);
              })}>Reintentar con mi sesión de Brave</button>}
            </div>
            {(project.error_code === "youtube_session_required" || project.error?.includes("YouTube bloqueó")) && <p className={styles.hint}>Al elegir «mi sesión de Brave» autorizas a utilizar las cookies de ese navegador para autenticar esta descarga en YouTube. Se aplica solo a este intento. Si macOS solicita acceso al llavero, revisa y autoriza ese acceso tú mismo. YouTube puede seguir requiriendo una verificación.</p>}
          </div>}
        </div>}
        {project.media_ready && <>
          <div className={styles.editorGrid}>
            <div>
              <div className={styles.previewHeading}><span>VISTA PREVIA DEL CLIP</span><b>{vertical ? "9:16 · TikTok / Reels" : "Formato original"}</b></div>
              <div className={`${styles.player} ${vertical ? styles.verticalPlayer : ""}`} style={{ aspectRatio: outputRatio }}>
                <video style={{ aspectRatio: outputRatio, objectFit: style.layout === "vertical_crop" ? "cover" : "contain", objectPosition: `${style.crop_x}% center` }} ref={video} key={project.id} src={file("preview.mp4")} controls={!style.background_id} playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => {
                  const t = e.currentTarget.currentTime; setCurrent(t);
                  if (previewEnd.current !== null && t >= previewEnd.current && !e.currentTarget.paused) { e.currentTarget.pause(); previewEnd.current = null; }
                }} />
                {style.background_id && <img className={styles.backgroundImage} style={{ objectPosition: `${style.crop_x}% center` }} src={`/api/music/library/${style.background_id}/file`} alt={selectedBackground?.title || "Fondo seleccionado"} />}
                {style.background_id && <div className={styles.backgroundControls}>
                  <button aria-label={playing ? "Pausar canción" : "Reproducir canción"} onClick={() => { if (video.current) { if (video.current.paused) void video.current.play().catch(() => {}); else video.current.pause(); } }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                  <span>{time(current)} / {time(project.duration)}</span>
                  <input aria-label="Posición de la canción" type="range" min={0} max={project.duration} step="0.1" value={current} onChange={e => { const value = Number(e.target.value); if (video.current) video.current.currentTime = value; setCurrent(value); }} />
                </div>}
                <div className={styles.accountOverlay}>Lunalgia</div>
                <div className={styles.songOverlay}>{project.title}</div>
                {style.mode !== "none" && <div className={styles.captions} style={{ top: "50%", bottom: "auto", transform: "translateY(-50%)", fontSize: `${style.font_size / (outputHeight * outputRatio) * 100}cqw`, fontFamily: `'${style.font}', Arial, sans-serif`, fontStyle: style.font === "Georgia" ? "italic" : "normal", color: { white: "#fff", yellow: "#ffff00", cyan: "#00ffff" }[style.color] }}>
                  {activeCue && <div key={`${activeCue.start}-${activeCue.text}`}>{activeCue.text}</div>}
                </div>}
                {vertical && <span className={styles.formatBadge}>9:16</span>}
              </div>
              <p className={styles.captionNote}>Frases cortas · hasta {style.max_words} palabras por bloque.{estimated ? " Tiempos estimados: usa Mejorar sincronía para reprocesar desde el audio." : " Revisa la sincronía escuchando el clip."}</p>
              {captionError && <p className={styles.error}>{captionError}</p>}
              <div className={styles.timeline} aria-label="Energía musical; selecciona un punto para escuchar">
                {project.timeline.map((point, index) => <button key={index} title={`${time(point.time)} · Energía ${Math.round(point.energy * 100)}%`} onClick={() => seek(point.time)} style={{ height: `${Math.max(5, point.energy * 100)}%`, background: point.attack > .75 ? "var(--purple)" : "var(--cyan)", opacity: point.time >= range.start && point.time <= range.end ? 1 : .3 }} aria-label={`Escuchar en ${time(point.time)}`} />)}
              </div>
              <div className={styles.legend}><span>0:00</span><span>Energía · ataques en violeta</span><span>{time(project.duration)}</span></div>
              <div className={styles.panel}>
                <h3><Scissors size={17} /> Recorte y exportación</h3>
                <div className={styles.options}>
                  <label>Inicio (segundos)<input type="number" min={0} max={project.duration} step="0.1" value={range.start} onChange={e => setRange(r => ({ ...r, start: Number(e.target.value) }))} /></label>
                  <label>Fin (segundos)<input type="number" min={0} max={project.duration} step="0.1" value={range.end} onChange={e => setRange(r => ({ ...r, end: Number(e.target.value) }))} /></label>
                </div>
                <div className={styles.actions}>
                  <button onClick={() => seek(range.start, range.end)}><Play size={15} /> Escuchar selección</button>
                  <button onClick={() => setRange({ start: 0, end: project.duration })}>Canción completa</button>
                </div>
                <div className={styles.options}>
                  <label>Formato del clip<select value={style.layout} disabled={!!style.background_id} onChange={e => setStyle(s => ({ ...s, layout: e.target.value as Style["layout"] }))}>
                    <option value="vertical_crop">Vertical 9:16 · llenar pantalla</option><option value="vertical_fit">Vertical 9:16 · video completo</option><option value="original">Original horizontal</option>
                  </select></label>
                  <label>Tipografía<select value={style.font} onChange={e => setStyle(s => ({ ...s, font: e.target.value as Style["font"] }))}>
                    <option value="Avenir Next">Cine · Avenir Next</option><option value="Georgia">Editorial · Georgia cursiva</option><option value="Arial">Impacto · Arial negrita</option>
                  </select></label>
                  <div className={styles.fixedStyle}>MAYÚSCULAS · CENTRADO</div>
                  <label>Palabras por bloque<select value={style.max_words} onChange={e => setStyle(s => ({ ...s, max_words: Number(e.target.value) }))}>{[3, 4, 5, 6, 8].map(n => <option key={n} value={n}>{n} palabras</option>)}</select></label>
                </div>
                {style.layout === "vertical_crop" && <label>Encuadre horizontal · {style.crop_x}%<input type="range" min={0} max={100} value={style.crop_x} onChange={e => setStyle(s => ({ ...s, crop_x: Number(e.target.value) }))} /></label>}
                <div className={styles.options}>
                  <label>Tamaño<input type="range" min={20} max={90} value={style.font_size} onChange={e => setStyle(s => ({ ...s, font_size: Number(e.target.value) }))} /></label>

                  <label>Color<select value={style.color} onChange={e => setStyle(s => ({ ...s, color: e.target.value as Style["color"] }))}><option value="white">Blanco</option><option value="yellow">Amarillo</option><option value="cyan">Cian</option></select></label>
                </div>
                <button className={styles.primary} disabled={!!busy || range.end <= range.start || range.end > project.duration} onClick={() => void perform(async () => {
                  await api(`/${project.id}/exports`, "POST", { lyrics: lines, ...range, style });
                  setDirty(false); setPolling(true);
                })}>{busy ? <Loader2 className={styles.spin} size={17} /> : <Download size={17} />} {project.export?.status === "processing" ? "Exportando…" : "Exportar MP4"}</button>
                {project.export?.status === "error" && <p className={styles.error}>{project.export.error}</p>}
                {project.export?.status === "done" && <div className={styles.downloads}>
                  <a href={file(`${project.export.id}.mp4`)} download>Descargar último MP4</a>
                  <a href={file(`${project.export.id}.original.srt`)} download>SRT original</a>
                  {project.export.spanish_srt && <a href={file(`${project.export.id}.spanish.srt`)} download>SRT español</a>}
                </div>}
              </div>
            </div>
            <aside className={styles.panel}>
              <h3><ImagePlus size={18} /> Imagen o GIF de fondo</h3>
              <p className={styles.hint}>Carga tu archivo para reemplazar la escena original. La canción y los subtítulos se mantienen.</p>
              <div className={styles.libraryToolbar}>
                <label className={styles.uploadButton}><Upload size={15} /> {style.background_id ? "Cambiar imagen o GIF" : "Cargar imagen o GIF"}<input aria-label="Cargar imagen o GIF de fondo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!!busy} onChange={e => {
                  const input = e.currentTarget; const file = input.files?.[0]; if (!file) return;
                  void perform(async () => {
                    if (file.size > 20 * 1024 * 1024) throw new Error("El archivo debe pesar como máximo 20 MB.");
                    const response = await fetch(`/api/music/library?title=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
                    const result = await response.json(); if (!response.ok) throw new Error(result.detail || "No se pudo subir el fondo.");
                    setBackgrounds(old => [...old, result]); setStyle(s => ({ ...s, background_id: result.id, layout: "vertical_crop" })); setNotice("Fondo cargado. Reemplaza la escena original en la vista previa y en la exportación.");
                  }).finally(() => { input.value = ""; });
                }} /></label>
                {style.background_id && <button disabled={!!busy} onClick={() => setStyle(s => ({ ...s, background_id: null }))}>Volver al video original</button>}
              </div>
              {style.background_id && <div className={styles.currentBackground}><img src={`/api/music/library/${style.background_id}/file`} alt="Fondo cargado" /><div><strong>{selectedBackground?.title || "Tu fondo"}</strong><small>{selectedBackground?.kind === "gif" ? "GIF animado · se repite durante el clip" : "Reemplaza la escena original"}</small></div></div>}
              {libraryError && <p className={styles.hint}>{libraryError}</p>}
              <p className={styles.hint}>JPG, PNG, WebP o GIF · máximo 20 MB. El GIF se repite durante el clip.</p>
              <div className={styles.libraryDivider} />
              <h3><AudioLines size={18} /> Encuentra tu próximo clip</h3>
              <p className={styles.hint}>Hasta 4 clips por canción, con un mínimo de 20 segundos. Coros, frases que conectan y momentos fuertes. Las propuestas de letra usan tus frases existentes.</p>
              <button className={styles.findMoments} disabled={!!busy || !lines.length} onClick={() => void perform(async () => { await save(); await api(`/${project.id}/highlights`, "POST"); setPolling(true); })}>Buscar coros y frases con IA</button>
              {project.insights_error && <p className={styles.hint}>{project.insights_error}</p>}
              <div className={styles.filters} aria-label="Filtrar momentos">{[["all", "Todos"], ["chorus", "Posibles coros"], ["relatable", "Me identifica"], ["climax", "Clímax"], ["energy", "Energía"]].map(([key, label]) => <button key={key} aria-pressed={momentFilter === key} onClick={() => setMomentFilter(key)}>{label}</button>)}</div>
              {!filteredMoments.length && <p className={styles.empty}>Sin propuestas en esta categoría. Busca por letra o selecciona un recorte manual.</p>}
              {filteredMoments.map((moment, i) => <div key={`${project.id}-${moment.start}-${moment.end}`} className={styles.clipCard}><button className={styles.moment} onClick={() => seek(moment.start, moment.end)}>
                <span className={styles.momentNumber}>{String(i + 1).padStart(2, "0")}</span><span><span className={styles.kindLabel}>{{ chorus: "POSIBLE CORO", relatable: "ME IDENTIFICA", climax: "CLÍMAX", energy: "ENERGÍA" }[moment.kind || "energy"]}</span><strong>{moment.reason}</strong>{moment.quote && <span className={styles.quote}>“{moment.quote}”</span>}<small>{time(moment.start)} — {time(moment.end)} · {Math.round(moment.end-moment.start)} s</small></span><span className={styles.score}>{moment.score}<small>/100</small></span>
              </button>
                <ClipPost description={moment.post_description || `esta parte se me quedó dando vueltas.\n\n#Lunalgia #${project.title.split(/\s+[-–—]\s+/)[0].replace(/[^\p{L}\p{N}]/gu, "")} #Musica`} />
              </div>)}
            </aside>
          </div>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><h3>Letra y subtítulos {dirty && <small>· Cambios sin guardar</small>}</h3>
              <div className={styles.actions}>
                <button disabled={!!busy} onClick={() => void perform(async () => { await save(); setNotice("Letra guardada."); })}><Save size={16} /> Guardar</button>
                <button disabled={!!busy} onClick={() => void perform(async () => {
                  if (!window.confirm("Esto volverá a transcribir y traducir desde el audio y reemplazará la letra editada. ¿Quieres continuar?")) return;
                  await api(`/${project.id}/transcribe`, "POST"); setPolling(true);
                })}>Mejorar sincronía</button>
                <button disabled={!!busy || !lines.length} onClick={() => void perform(async () => { await save(); await api(`/${project.id}/review`, "POST"); setPolling(true); })}>Revisar letra y traducción</button>
                <button disabled={!!busy || !lines.length} onClick={() => void perform(async () => { await save(); await api(`/${project.id}/translate`, "POST"); setPolling(true); })}><Languages size={16} /> Traducir al español</button>
              </div>
            </div>
            {project.review_error && <p className={styles.error}>Revisión pendiente: {project.review_error}. La letra previa se conserva; puedes reintentar la revisión.</p>}
            {!!project.review_version && <p className={styles.hint}>{project.review_method === "audio" ? "Revisión contrastada con el audio" : "Revisión por contexto; no verificada contra el audio"} · {project.review_changes?.length || 0} correcciones · {project.review_doubts?.length || 0} fragmentos por revisar. La sincronización del español sigue siendo estimada dentro de cada frase.</p>}
            {!!project.review_changes?.length && <details><summary>Comparar correcciones de la letra original</summary>
              {project.review_changes.map(change => <div className={styles.panel} key={change.id}>
                <button onClick={() => seek(change.start)}>Escuchar {time(change.start)}</button>
                <p><del>{change.before}</del></p><p>{change.after}</p>
                <small>{change.reason} · {change.evidence === "audio" ? "Con audio" : "Inferido por contexto"}</small>
              </div>)}
            </details>}
            {!!project.review_doubts?.length && <details><summary>Fragmentos dudosos: escuchar y corregir</summary>
              {project.review_doubts.map(doubt => <p key={doubt.id}><button onClick={() => seek(doubt.start)}>{time(doubt.start)}</button> {doubt.reason}</p>)}
            </details>}
            {!!project.raw_transcription?.length && <details><summary>Ver transcripción original sin revisar</summary>
              {project.raw_transcription.map(line => <p key={line.id}>{time(line.start)} · {line.original}</p>)}
            </details>}
            {project.warnings?.map(warning => <p className={styles.hint} key={warning}>{warning}</p>)}
            {project.translation_error && <p className={styles.error}>Traducción pendiente: {project.translation_error}</p>}
            {project.lyrics_error && <p className={styles.error}>Letra pendiente: {project.lyrics_error} <button disabled={!!busy} onClick={() => void perform(async () => { await api(`/${project.id}/transcribe`, "POST"); setPolling(true); })}>Reintentar transcripción</button></p>}
            {!lines.length && <p className={styles.empty}>Sin letra. Puedes añadir frases manualmente o exportar sin subtítulos.</p>}
            <div className={styles.lyrics}>
              {lines.map(line => <div className={styles.line} key={line.id}>
                <div className={styles.lineTimes}>
                  <button onClick={() => seek(line.start)} aria-label={`Escuchar frase ${line.id + 1}`}><Play size={14} /></button>
                  <label>Inicio<input aria-label={`Inicio frase ${line.id + 1}`} type="number" min={0} step="0.1" value={line.start} onChange={e => edit(line.id, { start: Number(e.target.value) })} disabled={!!busy} /></label>
                  <label>Fin<input aria-label={`Fin frase ${line.id + 1}`} type="number" min={0} step="0.1" value={line.end} onChange={e => edit(line.id, { end: Number(e.target.value) })} disabled={!!busy} /></label>
                </div>
                <label>Original<textarea value={line.original} onChange={e => edit(line.id, { original: e.target.value })} disabled={!!busy} /></label>
                <label>Español<textarea value={line.spanish} onChange={e => edit(line.id, { spanish: e.target.value })} disabled={!!busy} /></label>
                <button aria-label={`Eliminar frase ${line.id + 1}`} disabled={!!busy} onClick={() => { setLines(old => old.filter(l => l.id !== line.id)); setDirty(true); }}>×</button>
              </div>)}
            </div>
            <button disabled={!!busy} onClick={() => { setLines(old => [...old, { id: Math.max(-1, ...old.map(l => l.id)) + 1, start: Math.min(current, project.duration - .1), end: Math.min(project.duration, current + 3), original: "", spanish: "" }].sort((a, b) => a.start - b.start)); setDirty(true); }}><Plus size={16} /> Añadir frase en {time(current)}</button>
          </section>
        </>}
      </section>}
      <section id="history" className={styles.history}>
        <div className={styles.sectionTitle}><h2>Mis canciones</h2><span>{projects.length} análisis</span></div>
        {!projects.length && <p className={styles.empty}>Tus canciones aparecerán aquí. Puedes volver a abrirlas para editar y exportar.</p>}
        <div className={styles.historyGrid}>{projects.map(item => <button disabled={!!busy} key={item.id} onClick={() => void openProject(item.id)}><Music2 size={22} /><strong>{item.title}</strong><small>{time(item.duration || 0)} · {{ done: "Listo", error: "Requiere atención", processing: "Procesando", queued: "En cola" }[item.status] || item.status}</small></button>)}</div>
      </section>
    </main>
  );
}
