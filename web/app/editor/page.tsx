"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Scissors,
  Type,
  Captions,
  Layers,
  Plus,
  Minus,
  CheckCircle,
  Loader,
  Eye,
  EyeOff,
  Sparkles,
  Share2,
  Copy,
  Check,
  Play,
  RotateCcw,
} from "lucide-react";
import styles from "./page.module.css";

/* ─── Tipos ─────────────────────────────────────────────────── */

type CropMode = "smart_vertical" | "vertical_blur" | "original" | "split_screen";
type SubTheme = "hormozi" | "cyberpunk" | "minimal" | "none";

interface ColorPreset {
  label: string;
  base: string;
  highlight: string;
  assBase: string;
  assHighlight: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  {
    label: "Amarillo",
    base: "#ffffff",
    highlight: "#ffff00",
    assBase: "&H00FFFFFF&",
    assHighlight: "&H0000FFFF&",
  },
  {
    label: "Cyan",
    base: "#ffffff",
    highlight: "#00ffff",
    assBase: "&H00FFFFFF&",
    assHighlight: "&H00FFFF00&",
  },
  {
    label: "Verde",
    base: "#ffffff",
    highlight: "#00ff88",
    assBase: "&H00FFFFFF&",
    assHighlight: "&H0088FF00&",
  },
  {
    label: "Magenta",
    base: "#ffffff",
    highlight: "#ff44ff",
    assBase: "&H00FFFFFF&",
    assHighlight: "&H00FF44FF&",
  },
];

const THEME_CONFIG: Record<SubTheme, { label: string; fontLabel: string }> = {
  hormozi: { label: "Hormozi (Bold)", fontLabel: "Arial Black" },
  cyberpunk: { label: "Cyberpunk (Neon)", fontLabel: "Impact" },
  minimal: { label: "Minimal (Clean)", fontLabel: "Helvetica" },
  none: { label: "Sin Subtítulos", fontLabel: "Ninguno" },
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function EditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Query params
  const paramClipId = searchParams.get("clipId");
  const paramVideoId = searchParams.get("videoId");
  const paramStart = searchParams.get("start");
  const paramEnd = searchParams.get("end");
  const paramIndex = searchParams.get("index");
  const paramReturnUrl = searchParams.get("returnUrl");

  // Core Clip State
  const [clipId, setClipId] = useState<number | undefined>(
    paramClipId ? parseInt(paramClipId, 10) : undefined
  );
  const [index, setIndex] = useState<number>(
    paramIndex ? parseInt(paramIndex, 10) : 0
  );
  const [videoId, setVideoId] = useState<string>(paramVideoId || "");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [returnUrl, setReturnUrl] = useState<string>(paramReturnUrl || "/history");

  const [title, setTitle] = useState<string>("Momento Destacado");
  const [startSec, setStartSec] = useState<number>(paramStart ? parseFloat(paramStart) : 0);
  const [endSec, setEndSec] = useState<number>(paramEnd ? parseFloat(paramEnd) : 30);
  const [caption, setCaption] = useState<string>("");
  const [hashtags, setHashtags] = useState<string>("");

  // Editor Tools State
  const [activeTab, setActiveTab] = useState<"crop" | "subtitles" | "hook" | "copy">("crop");
  const [mode, setMode] = useState<CropMode>("smart_vertical");

  const [hookEnabled, setHookEnabled] = useState(true);
  const [hookText, setHookText] = useState("");
  const [hookDuration, setHookDuration] = useState(3.5);

  const [subTheme, setSubTheme] = useState<SubTheme>("hormozi");
  const [colorPresetIdx, setColorPresetIdx] = useState(0);
  const [marginV, setMarginV] = useState(380);
  const [showSafeZones, setShowSafeZones] = useState(false);

  // Export State
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderLabel, setRenderLabel] = useState("");
  const [renderSuccess, setRenderSuccess] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [copiedText, setCopiedText] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load from sessionStorage or API
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("clypfast_edit_clip");
      if (stored) {
        const data = JSON.parse(stored);
        if (data.clip) {
          if (data.clip.id) setClipId(data.clip.id);
          if (data.clip.title) {
            setTitle(data.clip.title);
            if (!hookText) setHookText(data.clip.title);
          }
          if (data.clip.start_seconds != null) setStartSec(data.clip.start_seconds);
          if (data.clip.end_seconds != null) setEndSec(data.clip.end_seconds);
          if (data.clip.caption) setCaption(data.clip.caption);
          if (data.clip.hashtags) {
            setHashtags(
              Array.isArray(data.clip.hashtags)
                ? data.clip.hashtags.join(" ")
                : data.clip.hashtags
            );
          }
        }
        if (data.index != null) setIndex(data.index);
        if (data.videoId) setVideoId(data.videoId);
        if (data.videoUrl) setVideoUrl(data.videoUrl);
        if (data.returnUrl) setReturnUrl(data.returnUrl);
        return;
      }
    } catch {
      // ignore
    }

    // Fallback: fetch from API if clipId exists
    if (paramClipId) {
      fetch(`/api/clips/${paramClipId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setTitle(data.title);
            setHookText(data.title);
            setStartSec(data.start_seconds);
            setEndSec(data.end_seconds);
            if (data.caption) setCaption(data.caption);
            if (data.hashtags) setHashtags(data.hashtags);
            if (data.video_source) setVideoUrl(data.video_source);
          }
        })
        .catch(() => {});
    }
  }, [paramClipId]);

  useEffect(() => {
    if (!hookText && title) {
      setHookText(title);
    }
  }, [title, hookText]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const duration = Math.max(1, Math.round(endSec - startSec));
  const preset = COLOR_PRESETS[colorPresetIdx];

  // Steppers
  const adjustStart = useCallback((delta: number) => {
    setStartSec((s) => Math.max(0, parseFloat((s + delta).toFixed(1))));
  }, []);

  const adjustEnd = useCallback(
    (delta: number) => {
      setEndSec((e) => Math.max(startSec + 5, parseFloat((e + delta).toFixed(1))));
    },
    [startSec]
  );

  // Export Trigger
  const handleExport = async () => {
    setRenderError("");
    setIsRendering(true);
    setRenderProgress(5);
    setRenderLabel("Iniciando procesamiento...");

    const targetUrl =
      videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

    if (!targetUrl) {
      setRenderError("No se encontró la URL del video para exportar.");
      setIsRendering(false);
      return;
    }

    try {
      const res = await fetch("/api/clips/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          clip_index: index,
          start_seconds: startSec,
          end_seconds: endSec,
          title: title,
          mode,
          subtitle_theme: subTheme,
          include_hook_title: hookEnabled,
          normalize_audio: true,
          clip_id: clipId,
          hook_title_custom: hookText !== title ? hookText : null,
          hook_duration: hookDuration,
          sub_base_color: subTheme !== "none" ? preset.assBase : null,
          sub_highlight_color: subTheme !== "none" ? preset.assHighlight : null,
          sub_margin_v: marginV,
        }),
      });

      if (!res.ok) throw new Error("Error al iniciar el renderizado.");
      const { render_id } = await res.json();

      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`/api/clips/render-status/${render_id}`);
          if (!sr.ok) return;
          const data = await sr.json();
          setRenderProgress(data.progress ?? 0);
          setRenderLabel(data.step_label ?? "Procesando clip 9:16...");

          if (data.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRendering(false);
            setRenderSuccess(true);

            // Trigger download
            const a = document.createElement("a");
            a.href = `/api/clips/download/${data.filename}`;
            a.download = data.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          } else if (data.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRendering(false);
            setRenderError(data.error ?? "Error al renderizar el clip.");
          }
        } catch {
          // ignore
        }
      }, 1000);
    } catch (err: unknown) {
      setIsRendering(false);
      setRenderError(err instanceof Error ? err.message : "Error desconocido.");
    }
  };

  const handleCopyText = () => {
    const full = `${caption || title}\n\n${hashtags}`.trim();
    navigator.clipboard.writeText(full);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  return (
    <div className={styles.editorWrapper}>
      <div className={styles.bgOrb1} />
      <div className={styles.bgOrb2} />

      {/* Top Studio Navbar */}
      <header className={styles.topNav}>
        <div className={styles.topNavInner}>
          <div className={styles.navLeft}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => {
                if (returnUrl) router.push(returnUrl);
                else router.back();
              }}
            >
              <ArrowLeft size={14} />
              Volver
            </button>

            <Link href="/" className="logo" style={{ display: "flex", alignItems: "center" }}>
              <Image
                src="/logo-clypfast.png"
                alt="ClypFast"
                width={110}
                height={26}
                style={{ height: "22px", width: "auto" }}
              />
            </Link>

            <div className={styles.titleArea}>
              <span className={styles.clipBadge}>Clip #{index + 1}</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={styles.clipTitleInput}
                title="Editar título del clip"
              />
            </div>
          </div>

          <div className={styles.navRight}>
            <div className={styles.durationBadge}>
              <span>Duración:</span>
              <span className={styles.durationVal}>{duration}s</span>
            </div>

            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExport}
              disabled={isRendering}
            >
              {isRendering ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  <span>Renderizando ({renderProgress}%)...</span>
                </>
              ) : (
                <>
                  <Download size={15} />
                  <span>Exportar Clip 9:16</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Workstation */}
      <main className={styles.studioContainer}>
        {/* Left: Interactive 9:16 Canvas & Scrubbing */}
        <section className={styles.canvasCol}>
          {/* Smartphone 9:16 Frame */}
          <div className={styles.phoneFrame}>
            <div className={styles.phoneVideoLayer}>
              {/* Blurred background layer when in vertical_blur mode */}
              {mode === "vertical_blur" && videoId && (
                <div
                  className={styles.phoneBlurredBg}
                  style={{
                    backgroundImage: `url(https://img.youtube.com/vi/${videoId}/hqdefault.jpg)`,
                  }}
                />
              )}

              {/* YouTube Video / Embed */}
              {videoId ? (
                <iframe
                  src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(
                    startSec
                  )}&end=${Math.ceil(endSec)}&autoplay=0&controls=1&rel=0&modestbranding=1`}
                  className={mode === "original" ? styles.phoneOriginalBox : styles.phonePlayer}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Vista previa del clip"
                />
              ) : (
                <div style={{ color: "#94a3b8", textAlign: "center", padding: 20 }}>
                  <Play size={32} style={{ margin: "0 auto 8px" }} />
                  <p style={{ fontSize: 12 }}>Previsualización de video</p>
                </div>
              )}
            </div>

            {/* Hook Banner Overlay */}
            {hookEnabled && hookText && (
              <div className={styles.hudHookBanner}>
                <span className={styles.hudHookTag}>🔥 Momento Viral</span>
                <p className={styles.hudHookText}>{hookText}</p>
              </div>
            )}

            {/* Subtitles Overlay */}
            {subTheme !== "none" && (
              <div
                className={styles.hudSubtitles}
                style={{
                  bottom: `${(marginV / 1920) * 100}%`,
                }}
              >
                <span
                  className={styles.hudSubWord}
                  style={{
                    color: preset.base,
                    fontFamily: THEME_CONFIG[subTheme].fontLabel,
                  }}
                >
                  ESTE
                </span>
                <span
                  className={styles.hudSubWord}
                  style={{
                    color: preset.highlight,
                    fontFamily: THEME_CONFIG[subTheme].fontLabel,
                    transform: "scale(1.08)",
                  }}
                >
                  MOMENTO
                </span>
                <span
                  className={styles.hudSubWord}
                  style={{
                    color: preset.base,
                    fontFamily: THEME_CONFIG[subTheme].fontLabel,
                  }}
                >
                  ES VIRAL
                </span>
              </div>
            )}

            {/* Safe Zones Guides */}
            {showSafeZones && (
              <div className={styles.safeZonesOverlay}>
                <div className={styles.safeZoneTop}>
                  <span className={styles.safeZoneText}>Zona Superior UI</span>
                </div>
                <div className={styles.safeZoneRight}>
                  <span className={styles.safeZoneText}>Iconos</span>
                </div>
                <div className={styles.safeZoneBottom}>
                  <span className={styles.safeZoneText}>Texto & Sonido</span>
                </div>
              </div>
            )}
          </div>

          {/* Timeline & Trim Stepper */}
          <div className={styles.timelineBar}>
            <div className={styles.timelineControls}>
              {/* Start Stepper */}
              <div className={styles.stepperGroup}>
                <span className={styles.stepperLabel}>Inicio:</span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustStart(-1)}
                  title="-1 segundo"
                >
                  -1
                </button>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustStart(-0.5)}
                  title="-0.5s"
                >
                  -
                </button>
                <span className={styles.stepperVal}>{formatTime(startSec)}</span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustStart(0.5)}
                  title="+0.5s"
                >
                  +
                </button>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustStart(1)}
                  title="+1 segundo"
                >
                  +1
                </button>
              </div>

              {/* End Stepper */}
              <div className={styles.stepperGroup}>
                <span className={styles.stepperLabel}>Fin:</span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustEnd(-1)}
                  title="-1 segundo"
                >
                  -1
                </button>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustEnd(-0.5)}
                  title="-0.5s"
                >
                  -
                </button>
                <span className={styles.stepperVal}>{formatTime(endSec)}</span>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustEnd(0.5)}
                  title="+0.5s"
                >
                  +
                </button>
                <button
                  type="button"
                  className={styles.stepBtn}
                  onClick={() => adjustEnd(1)}
                  title="+1 segundo"
                >
                  +1
                </button>
              </div>

              {/* Safe zones button */}
              <button
                type="button"
                className={styles.backBtn}
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => setShowSafeZones(!showSafeZones)}
              >
                {showSafeZones ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>Safe Zones</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right: Studio Customization Panels */}
        <aside className={styles.toolsCol}>
          {/* Tab Selection */}
          <div className={styles.toolTabs}>
            <button
              type="button"
              className={`${styles.toolTab} ${activeTab === "crop" ? styles.toolTabActive : ""}`}
              onClick={() => setActiveTab("crop")}
            >
              <Layers size={14} />
              Encuadre
            </button>
            <button
              type="button"
              className={`${styles.toolTab} ${activeTab === "subtitles" ? styles.toolTabActive : ""}`}
              onClick={() => setActiveTab("subtitles")}
            >
              <Captions size={14} />
              Subtítulos
            </button>
            <button
              type="button"
              className={`${styles.toolTab} ${activeTab === "hook" ? styles.toolTabActive : ""}`}
              onClick={() => setActiveTab("hook")}
            >
              <Type size={14} />
              Gancho
            </button>
            <button
              type="button"
              className={`${styles.toolTab} ${activeTab === "copy" ? styles.toolTabActive : ""}`}
              onClick={() => setActiveTab("copy")}
            >
              <Share2 size={14} />
              Copy Social
            </button>
          </div>

          <div className={styles.panelContent}>
            {/* TAB 1: ENCUADRE (CROP) */}
            {activeTab === "crop" && (
              <>
                <div className={styles.sectionHeader}>
                  <Layers size={15} />
                  Modo de Encuadre 9:16
                </div>
                <div className={styles.cropGrid}>
                  <button
                    type="button"
                    className={`${styles.cropOption} ${
                      mode === "smart_vertical" ? styles.cropOptionActive : ""
                    }`}
                    onClick={() => setMode("smart_vertical")}
                  >
                    <div className={styles.cropTitle}>🎯 IA Face Tracking</div>
                    <div className={styles.cropDesc}>
                      Detecta caras con MediaPipe y encuadra al hablante en 9:16.
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`${styles.cropOption} ${
                      mode === "vertical_blur" ? styles.cropOptionActive : ""
                    }`}
                    onClick={() => setMode("vertical_blur")}
                  >
                    <div className={styles.cropTitle}>🌫️ Blur Vertical</div>
                    <div className={styles.cropDesc}>
                      Fondo difuminado estético para clips sin deformar.
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`${styles.cropOption} ${
                      mode === "split_screen" ? styles.cropOptionActive : ""
                    }`}
                    onClick={() => setMode("split_screen")}
                  >
                    <div className={styles.cropTitle}>👥 Split Screen</div>
                    <div className={styles.cropDesc}>
                      Dos hablantes apilados arriba y abajo (ideal podcasts).
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`${styles.cropOption} ${
                      mode === "original" ? styles.cropOptionActive : ""
                    }`}
                    onClick={() => setMode("original")}
                  >
                    <div className={styles.cropTitle}>🎬 Original 16:9</div>
                    <div className={styles.cropDesc}>
                      Video completo centrado con barras verticales.
                    </div>
                  </button>
                </div>
              </>
            )}

            {/* TAB 2: SUBTÍTULOS */}
            {activeTab === "subtitles" && (
              <>
                <div className={styles.sectionHeader}>
                  <Captions size={15} />
                  Estilo de Subtítulos
                </div>
                <div className={styles.themeGrid}>
                  {(Object.keys(THEME_CONFIG) as SubTheme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.themeOption} ${
                        subTheme === t ? styles.themeOptionActive : ""
                      }`}
                      onClick={() => setSubTheme(t)}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {THEME_CONFIG[t].label}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                        Fuente: {THEME_CONFIG[t].fontLabel}
                      </div>
                    </button>
                  ))}
                </div>

                {subTheme !== "none" && (
                  <>
                    <div className={styles.sectionHeader} style={{ marginTop: 12 }}>
                      <Sparkles size={15} />
                      Paleta de Color
                    </div>
                    <div className={styles.colorList}>
                      {COLOR_PRESETS.map((p, idx) => (
                        <button
                          key={p.label}
                          type="button"
                          className={`${styles.colorSwatch} ${
                            colorPresetIdx === idx ? styles.colorSwatchActive : ""
                          }`}
                          onClick={() => setColorPresetIdx(idx)}
                        >
                          <span
                            className={styles.dot}
                            style={{ background: p.highlight }}
                          />
                          <span>{p.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className={styles.sectionHeader} style={{ marginTop: 12 }}>
                      <span>Posición Vertical (Altura)</span>
                    </div>
                    <input
                      type="range"
                      min={200}
                      max={700}
                      step={20}
                      value={marginV}
                      onChange={(e) => setMarginV(parseInt(e.target.value, 10))}
                      className={styles.rangeSlider}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#94a3b8",
                      }}
                    >
                      <span>Inferior</span>
                      <span>{marginV}px</span>
                      <span>Centro</span>
                    </div>
                  </>
                )}
              </>
            )}

            {/* TAB 3: GANCHO VISUAL (HOOK) */}
            {activeTab === "hook" && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div className={styles.sectionHeader} style={{ margin: 0 }}>
                    <Type size={15} />
                    Gancho Superior (Hook Title)
                  </div>
                  <input
                    type="checkbox"
                    checked={hookEnabled}
                    onChange={(e) => setHookEnabled(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: "#8b5cf6" }}
                  />
                </div>

                {hookEnabled && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 6 }}>
                        Texto del Gancho:
                      </label>
                      <textarea
                        rows={3}
                        value={hookText}
                        onChange={(e) => setHookText(e.target.value)}
                        className={styles.hookInput}
                        placeholder="Escribe un título impactante que enganche en 3 segundos..."
                      />
                    </div>

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                        <span>Duración del Gancho:</span>
                        <strong style={{ color: "#fff" }}>{hookDuration} segundos</strong>
                      </div>
                      <input
                        type="range"
                        min={1.5}
                        max={8}
                        step={0.5}
                        value={hookDuration}
                        onChange={(e) => setHookDuration(parseFloat(e.target.value))}
                        className={styles.rangeSlider}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* TAB 4: COPY SOCIAL & HASHTAGS */}
            {activeTab === "copy" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className={styles.sectionHeader}>
                  <Share2 size={15} />
                  Copy para Redes Sociales
                </div>

                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>
                    Descripción sugerida:
                  </label>
                  <textarea
                    rows={4}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    className={styles.hookInput}
                    placeholder="Agrega una descripción para TikTok o Instagram..."
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>
                    Hashtags:
                  </label>
                  <input
                    type="text"
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    className={styles.hookInput}
                    placeholder="#viral #podcast #contenido"
                  />
                </div>

                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={handleCopyText}
                  style={{ justifyContent: "center", padding: "10px", marginTop: 6 }}
                >
                  {copiedText ? (
                    <>
                      <Check size={14} style={{ color: "#22c55e" }} />
                      <span style={{ color: "#22c55e" }}>¡Copiado al portapapeles!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Copiar Copy Completo</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Live Rendering Status */}
            {(isRendering || renderSuccess || renderError) && (
              <div className={styles.statusBanner}>
                {isRendering && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "#94a3b8" }}>{renderLabel}</span>
                      <strong style={{ color: "var(--cyan)" }}>{renderProgress}%</strong>
                    </div>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${renderProgress}%` }}
                      />
                    </div>
                  </>
                )}

                {renderSuccess && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#22c55e", fontSize: 13, fontWeight: 700 }}>
                    <CheckCircle size={16} />
                    ¡Clip renderizado y descargado con éxito!
                  </div>
                )}

                {renderError && (
                  <div style={{ color: "#ef4444", fontSize: 12 }}>
                    ⚠️ {renderError}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07090e", color: "#fff" }}>
          <Loader className="animate-spin" size={32} />
        </div>
      }
    >
      <EditorContent />
    </Suspense>
  );
}
