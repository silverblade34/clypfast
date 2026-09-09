"use client";

/**
 * ClipCustomizerModal.tsx – Fase 2
 *
 * Modal de personalización pre-descarga tipo mini-CapCut.
 * ARQUITECTURA: Este componente es un HUD visual puro (CSS/SVG).
 * NO renderiza ni graba video en el navegador. Al exportar, envía
 * únicamente parámetros JSON al backend ffmpeg (h264_videotoolbox 6M).
 *
 * Garantías WYSIWYG:
 * - Salto de línea determinista (mismo algoritmo que subtitles_burner.py).
 * - Espacio de coordenadas virtual 1080×1920 escalado con CSS.
 * - Colores y fuentes idénticos a los enviados al backend ASS.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Download,
  Scissors,
  Type,
  Captions,
  Layers,
  Plus,
  Minus,
  CheckCircle,
  Loader,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ScanFace,
  Maximize2,
  Columns2,
  Tv,
} from "lucide-react";
import type { Clip } from "./ClipCard";
import styles from "./ClipCustomizerModal.module.css";

/* ─── Tipos ─────────────────────────────────────────────────── */

type CropMode = "smart_vertical" | "vertical_blur" | "original" | "split_screen";
type SubTheme = "hormozi" | "minimal" | "cyberpunk" | "podcast" | "neon" | "classic" | "duotone" | "none";
type HookDecor = "none" | "fire" | "arrow" | "star" | "lightning" | "mic" | "bar";
type HookTheme = "impact" | "hormozi" | "badge" | "neon" | "fire" | "minimal";

interface ColorPreset {
  label: string;
  base: string;       // Formato CSS para el HUD visual
  highlight: string;
  assBase: string;    // Formato ASS (&H00BBGGRR&) para el backend
  assHighlight: string;
}

interface Props {
  clip: Clip;
  index: number;
  videoId?: string;
  videoUrl?: string;
  initialMode: CropMode;
  onClose: () => void;
  onExportDone?: (status: string) => void;
}

/* ─── Constantes ─────────────────────────────────────────────── */

/**
 * Paletas de color disponibles. Los valores CSS se usan solo para el HUD
 * visual del modal. Los valores ASS (BGR invertido) son los que llegan al
 * archivo .ass generado por ffmpeg/libass.
 */
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

const THEME_CONFIG: Record<SubTheme, { label: string; fontLabel: string; preview: string; desc: string }> = {
  hormozi: { label: "Hormozi", fontLabel: "Arial Black", preview: "BOLD", desc: "Texto grueso negro" },
  minimal: { label: "Minimal", fontLabel: "Helvetica", preview: "clean", desc: "Sutil y elegante" },
  cyberpunk: { label: "Impact", fontLabel: "Impact", preview: "IMPACT", desc: "Agresivo y viral" },
  podcast: { label: "Podcast", fontLabel: "Arial", preview: "Podcast", desc: "Nombre del speaker" },
  neon: { label: "Neon", fontLabel: "Impact", preview: "GLOW", desc: "Brillo neón" },
  classic: { label: "Classic", fontLabel: "Times New Roman", preview: "Classic", desc: "Estilo clásico TV" },
  duotone: { label: "Duotone", fontLabel: "Helvetica", preview: "DUO\nTONE", desc: "Dos colores" },
  none: { label: "Sin subs", fontLabel: "", preview: "—", desc: "Solo gancho" },
};

const HOOK_DECORS: { id: HookDecor; label: string; prefix: string; suffix: string }[] = [
  { id: "none",      label: "Limpio",    prefix: "",    suffix: "" },
  { id: "fire",      label: "Fuego",     prefix: "🔥 ", suffix: " 🔥" },
  { id: "arrow",     label: "Flecha",    prefix: "▶ ",  suffix: "" },
  { id: "star",      label: "Estrellas", prefix: "★ ",  suffix: " ★" },
  { id: "lightning", label: "Rayo",      prefix: "⚡ ", suffix: " ⚡" },
  { id: "mic",       label: "Micrófono", prefix: "🎙 ", suffix: "" },
  { id: "bar",       label: "Barra",     prefix: "| ",  suffix: " |" },
];

const HOOK_THEME_CONFIG: Record<HookTheme, { label: string; fontLabel: string; preview: string; desc: string }> = {
  impact:  { label: "Impact",  fontLabel: "'Impact', 'Arial Black', sans-serif", preview: "VIRAL",    desc: "Letra alta y contundente" },
  hormozi: { label: "Hormozi", fontLabel: "'Arial Black', Impact, sans-serif",   preview: "BOLD",     desc: "Grueso con borde negro" },
  badge:   { label: "Caja",    fontLabel: "'Impact', 'Arial Black', sans-serif", preview: "[ CAJA ]", desc: "Fondo oscuro estilo CapCut" },
  neon:    { label: "Neón",    fontLabel: "'Impact', 'Arial Black', sans-serif", preview: "GLOW",     desc: "Brillo luminoso cian" },
  fire:    { label: "Fuego",   fontLabel: "'Arial Black', Impact, sans-serif",   preview: "FUEGO",    desc: "Acento naranja y viral" },
  minimal: { label: "Minimal", fontLabel: "Helvetica, Arial, sans-serif",        preview: "clean",    desc: "Sutil y elegante" },
};

const MODE_CONFIG: {
  id: CropMode;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
}[] = [
  { id: "smart_vertical", label: "IA Smart",   desc: "Face tracking automático", Icon: ScanFace },
  { id: "vertical_blur",  label: "Blur BG",    desc: "Fondo difuminado suave",   Icon: Maximize2 },
  { id: "split_screen",   label: "Podcast",    desc: "Pantalla dividida",        Icon: Columns2 },
  { id: "original",       label: "Original",   desc: "Sin recorte 16:9",         Icon: Tv },
];

/* ─── Utilidades (espejadas del backend para WYSIWYG determinista) ── */

/**
 * Mismo algoritmo que generate_ass_subtitles en subtitles_burner.py.
 * Garantiza que el salto de línea en el HUD y en el .ass sean idénticos.
 */
function deterministicLineBreak(text: string, maxChars = 35): React.ReactNode {
  const upper = text.trim().toUpperCase();
  if (upper.length <= maxChars) return upper;

  const words = upper.split(" ");
  let mid = Math.floor(words.length / 2);
  while (mid > 1 && words.slice(0, mid).join(" ").length > maxChars) {
    mid--;
  }
  return (
    <>
      {words.slice(0, mid).join(" ")}
      <br />
      {words.slice(mid).join(" ")}
    </>
  );
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* ─── Componente Principal ────────────────────────────────────── */

export default function ClipCustomizerModal({
  clip,
  index,
  videoId,
  videoUrl,
  initialMode,
  onClose,
  onExportDone,
}: Props) {
  // ── Estado: Tiempos ──────────────────────────────────────────
  const [startSec, setStartSec] = useState(clip.start_seconds);
  const [endSec, setEndSec] = useState(clip.end_seconds);
  const videoDurationEstimate = endSec - startSec; // duración editable en tiempo real

  // ── Estado: Gancho ───────────────────────────────────────────────
  const [hookEnabled, setHookEnabled] = useState(true);
  const [hookText, setHookText] = useState(clip.title);
  const [hookDuration, setHookDuration] = useState(3.5);
  const [hookDecor, setHookDecor] = useState<HookDecor>("none");
  const [hookTheme, setHookTheme] = useState<HookTheme>("impact");

  // ── Estado: Subtítulos ───────────────────────────────────────
  const [subTheme, setSubTheme] = useState<SubTheme>("hormozi");
  const [colorPresetIdx, setColorPresetIdx] = useState(0);
  const [marginV, setMarginV] = useState(380);

  // ── Estado: Formato ──────────────────────────────────────────
  const [mode, setMode] = useState<CropMode>(initialMode);

  // ── Estado: Safe Zones ───────────────────────────────────────
  const [showSafeZones, setShowSafeZones] = useState(false);

  // ── Estado: Renderizado ──────────────────────────────────────
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderLabel, setRenderLabel] = useState("");
  const [renderSuccess, setRenderSuccess] = useState(false);
  const [renderError, setRenderError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup del polling ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Cerrar con Escape ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRendering) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isRendering, onClose]);

  // ── Trim rápido ──────────────────────────────────────────────
  const adjustStart = useCallback((delta: number) => {
    setStartSec((s) => Math.max(0, s + delta));
  }, []);

  const adjustEnd = useCallback((delta: number) => {
    setEndSec((e) => Math.max(startSec + 5, e + delta));
  }, [startSec]);

  // ── Exportar ─────────────────────────────────────────────────
  const handleExport = async () => {
    setRenderError("");
    setIsRendering(true);
    setRenderProgress(5);
    setRenderLabel("Iniciando procesamiento...");

    const targetUrl =
      videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

    if (!targetUrl) {
      setRenderError("No se encontró la URL del video.");
      setIsRendering(false);
      return;
    }

    const preset = COLOR_PRESETS[colorPresetIdx];
    const decor = HOOK_DECORS.find((d) => d.id === hookDecor) || HOOK_DECORS[0];
    const effectiveHook = hookEnabled
      ? `${decor.prefix}${hookText.trim()}${decor.suffix}`.trim()
      : null;
    const selectedFont = THEME_CONFIG[subTheme]?.fontLabel || null;

    try {
      const res = await fetch("/api/clips/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          clip_index: index,
          start_seconds: startSec,
          end_seconds: endSec,
          title: clip.title,
          mode,
          subtitle_theme: subTheme,
          include_hook_title: hookEnabled,
          normalize_audio: true,
          clip_id: clip.id,
          // Overrides del modal → backend
          hook_title_custom: effectiveHook,
          hook_duration: hookDuration,
          hook_theme: hookTheme,
          sub_font: selectedFont,
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
          setRenderLabel(data.step_label ?? "Procesando...");

          if (data.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRendering(false);
            setRenderSuccess(true);
            onExportDone?.(subTheme !== "none" ? "subtitulado" : "enfoque_generado");

            const a = document.createElement("a");
            a.href = `/api/clips/download/${data.filename}`;
            a.download = data.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => setRenderSuccess(false), 5000);
          } else if (data.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRendering(false);
            setRenderError(data.error ?? "Error al procesar.");
          }
        } catch {
          // polling silencioso
        }
      }, 1000);
    } catch (err: unknown) {
      setIsRendering(false);
      setRenderError(err instanceof Error ? err.message : "Error desconocido.");
    }
  };

  // ── Datos derivados ──────────────────────────────────────────
  const duration = Math.round(endSec - startSec);
  const preset = COLOR_PRESETS[colorPresetIdx];
  const originalDuration = Math.round(clip.end_seconds - clip.start_seconds);
  const durationChanged = duration !== originalDuration;

  // Posición del gancho como porcentaje sobre 1920px (para el HUD CSS)
  // margin_v 380 desde el fondo → top = (1920 - 380) / 1920 ≈ 80.2%
  const subsBottomPct = `${(marginV / 1920) * 100}%`;

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Personalizar clip">
      <div className={styles.panel}>

        {/* HEADER */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Scissors size={16} />
            </div>
            <div>
              <div className={styles.headerTitle}>Personalizar Clip</div>
              <div className={styles.headerSubtitle}>
                Clip {index + 1} · {originalDuration}s original
              </div>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isRendering}
            aria-label="Cerrar"
          >
            <X size={15} />
          </button>
        </div>

        {/* BODY */}
        <div className={styles.body}>

          {/* COLUMNA IZQUIERDA: Visor 9:16 + Trim */}
          <div className={styles.previewCol}>

            {/* Visor 9:16 */}
            <div className={styles.videoWrap}>
              {/* Capa de Safe Zones (guía TikTok/Reels) */}
              {showSafeZones && (
                <div className={styles.safeZonesOverlay}>
                  {/* Zona superior UI */}
                  <div
                    className={styles.safeZoneLine}
                    style={{ top: "12%" }}
                  />
                  <span
                    className={styles.safeZoneLabel}
                    style={{ top: "12%", transform: "translateY(-100%)" }}
                  >
                    Avatar TikTok
                  </span>
                  {/* Zona inferior UI */}
                  <div
                    className={styles.safeZoneLine}
                    style={{ bottom: "18%" }}
                  />
                  <span
                    className={styles.safeZoneLabel}
                    style={{ bottom: "18%" }}
                  >
                    Botones TikTok
                  </span>
                  {/* Descripción */}
                  <div
                    className={styles.safeZoneLine}
                    style={{ bottom: "10%" }}
                  />
                  <span
                    className={styles.safeZoneLabel}
                    style={{ bottom: "10%" }}
                  >
                    Descripción
                  </span>
                </div>
              )}

              {/* HUD: Gancho con decorador y plantilla seleccionable */}
              {hookEnabled && hookText && (() => {
                const decor = HOOK_DECORS.find((d) => d.id === hookDecor) || HOOK_DECORS[0];
                const isBadge = hookTheme === "badge";
                const isNeon = hookTheme === "neon";
                const isFire = hookTheme === "fire";
                const isMinimal = hookTheme === "minimal";

                return (
                  <div
                    className={styles.hookHUD}
                    style={{
                      fontFamily: HOOK_THEME_CONFIG[hookTheme]?.fontLabel || "'Impact', sans-serif",
                      fontWeight: isMinimal ? 700 : 900,
                      textTransform: isMinimal ? "none" : "uppercase",
                      letterSpacing: isMinimal ? "0.01em" : "0.03em",
                      color: isNeon ? "#00ffff" : isFire ? "#ffbb33" : "#ffffff",
                      background: isBadge ? "rgba(0, 0, 0, 0.85)" : "transparent",
                      padding: isBadge ? "5px 12px" : "0",
                      borderRadius: isBadge ? "8px" : "0",
                      border: isBadge ? "1px solid rgba(255, 255, 255, 0.18)" : "none",
                      boxShadow: isBadge ? "0 4px 14px rgba(0,0,0,0.7)" : "none",
                      textShadow: isNeon
                        ? "0 0 10px #00ffff, 0 0 20px #00aaff, 0 2px 4px #000"
                        : isFire
                        ? "0 0 12px #ff4400, 2px 2px 0 #000"
                        : isMinimal
                        ? "0 2px 6px rgba(0,0,0,0.9)"
                        : "0 0 6px #000, 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000",
                      WebkitTextStroke: isMinimal ? "0.8px #000" : isBadge ? "1.5px #000" : "2.5px #000",
                    }}
                  >
                    {decor.prefix ? `${decor.prefix} ` : ""}
                    {deterministicLineBreak(hookText)}
                    {decor.suffix ? ` ${decor.suffix}` : ""}
                  </div>
                );
              })()}

              {/* HUD: Subtítulos demo con reflejo fiel de plantilla */}
              {subTheme !== "none" && (() => {
                const isNeon = subTheme === "neon";
                const isMinimal = subTheme === "minimal";
                const isClassic = subTheme === "classic";
                const isPodcast = subTheme === "podcast";
                const isDuotone = subTheme === "duotone";
                const isCyberpunk = subTheme === "cyberpunk";

                const fontName = THEME_CONFIG[subTheme]?.fontLabel || "'Impact', sans-serif";
                const baseColor = isNeon ? "#00ffcc" : isDuotone ? "#c084fc" : isPodcast ? "#f8fafc" : preset.base;
                const highlightColor = isNeon ? "#ffff00" : isDuotone ? "#ffff00" : preset.highlight;

                return (
                  <div
                    className={styles.subsHUD}
                    style={{
                      bottom: subsBottomPct,
                      color: baseColor,
                      fontFamily: fontName,
                      fontStyle: isClassic ? "italic" : "normal",
                      fontWeight: isMinimal ? 600 : 900,
                      textTransform: (isMinimal || isClassic || isPodcast) ? "none" : "uppercase",
                      letterSpacing: isCyberpunk ? "0.03em" : "0.01em",
                      background: isPodcast ? "rgba(0, 0, 0, 0.72)" : "transparent",
                      padding: isPodcast ? "3px 10px" : "0",
                      borderRadius: isPodcast ? "5px" : "0",
                      border: isPodcast ? "1px solid rgba(255,255,255,0.12)" : "none",
                      textShadow: isNeon
                        ? "0 0 10px #00ffcc, 0 0 20px #00ffcc, 0 2px 4px #000"
                        : isMinimal
                        ? "0 2px 6px rgba(0,0,0,0.85)"
                        : `
                          0 0 6px #000,
                          2px 2px 0 #000,
                          -2px -2px 0 #000,
                          2px -2px 0 #000,
                          -2px 2px 0 #000
                        `,
                      WebkitTextStroke: isMinimal ? "0.7px #000" : isNeon ? "1px #000" : isPodcast ? "none" : "2px #000",
                    }}
                  >
                    Texto de{" "}
                    <span
                      style={{
                        color: highlightColor,
                        textShadow: isNeon ? "0 0 12px #ffff00, 0 0 20px #ffff00" : "inherit",
                        fontWeight: 900,
                      }}
                    >
                      ejemplo
                    </span>{" "}
                    en vivo
                  </div>
                );
              })()}
            </div>

            {/* Toggle Safe Zones */}
            <label className={styles.safeZoneToggle}>
              <input
                type="checkbox"
                checked={showSafeZones}
                onChange={(e) => setShowSafeZones(e.target.checked)}
              />
              {showSafeZones ? <EyeOff size={11} /> : <Eye size={11} />}
              Safe zones
            </label>

            {/* ─── TRIM ─── */}
            <div className={styles.trimSection}>
              <div className={styles.trimLabel}>
                <Scissors size={9} style={{ marginRight: 4 }} />
                Duración del clip
              </div>

              <div className={styles.trimDuration}>
                {duration}s
                {durationChanged && (
                  <span style={{ fontSize: 9, color: "#a78bfa", marginLeft: 5 }}>
                    (era {originalDuration}s)
                  </span>
                )}
              </div>

              {/* Botones rápidos inicio */}
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                Inicio: {formatSec(startSec)}
              </div>
              <div className={styles.trimQuickBtns}>
                <button className={styles.trimBtn} onClick={() => adjustStart(-5)} title="Iniciar 5s antes">
                  <ChevronLeft size={10} /> 5s
                </button>
                <button className={styles.trimBtn} onClick={() => adjustStart(5)} title="Iniciar 5s después">
                  5s <ChevronRight size={10} />
                </button>
              </div>

              {/* Botones rápidos fin */}
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8, marginBottom: 2 }}>
                Fin: {formatSec(endSec)}
              </div>
              <div className={styles.trimQuickBtns}>
                <button className={styles.trimBtn} onClick={() => adjustEnd(-5)} title="Terminar 5s antes">
                  <Minus size={10} /> 5s
                </button>
                <button className={styles.trimBtn} onClick={() => adjustEnd(5)} title="Extender 5s">
                  <Plus size={10} /> 5s
                </button>
              </div>

              <div className={styles.trimTimings} style={{ marginTop: 8 }}>
                <span>{formatSec(startSec)}</span>
                <span>{formatSec(endSec)}</span>
              </div>
            </div>
          </div>

          {/* COLUMNA DERECHA: Panel de controles */}
          <div className={styles.controlCol}>

            {/* ─── SECCIÓN: FORMATO (ARRIBA) ─── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={`${styles.sectionIcon} ${styles.amber}`}>
                  <Layers size={13} />
                </div>
                <span className={styles.sectionTitle}>Formato de Exportación</span>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "6px",
              }}>
                {MODE_CONFIG.map((m) => {
                  const IconComp = m.Icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`${styles.formatBtn} ${mode === m.id ? styles.active : ""}`}
                      onClick={() => setMode(m.id)}
                      style={{
                        padding: "8px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "9px",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "6px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background:
                            mode === m.id
                              ? "rgba(56, 189, 248, 0.2)"
                              : "rgba(255, 255, 255, 0.06)",
                          color: mode === m.id ? "#38bdf8" : "rgba(255, 255, 255, 0.75)",
                          flexShrink: 0,
                        }}
                      >
                        <IconComp size={15} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{m.label}</span>
                        <span style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>{m.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <hr className={styles.sectionDivider} />

            {/* ─── SECCIÓN: GANCHO ─── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={`${styles.sectionIcon} ${styles.cyan}`}>
                  <Type size={13} />
                </div>
                <span className={styles.sectionTitle}>Título de Gancho</span>
              </div>

              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Mostrar gancho inicial</span>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={hookEnabled}
                    onChange={(e) => setHookEnabled(e.target.checked)}
                  />
                  <span className={styles.toggleSlider} />
                </label>
              </div>

              {hookEnabled && (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Texto del gancho</label>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={hookText}
                      maxLength={80}
                      onChange={(e) => setHookText(e.target.value)}
                      placeholder="Escribe el gancho inicial..."
                    />
                  </div>

                  {/* Hook Theme Selector */}
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Plantilla del título</label>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: "6px",
                      marginTop: "4px",
                    }}>
                      {(Object.entries(HOOK_THEME_CONFIG) as [HookTheme, { label: string; preview: string; fontLabel: string; desc: string }][]).map(
                        ([id, cfg]) => {
                          const isSelected = hookTheme === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`${styles.themeBtn} ${isSelected ? styles.active : ""}`}
                              onClick={() => setHookTheme(id)}
                              title={cfg.desc}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "3px",
                                padding: "8px 4px",
                                minHeight: "48px",
                              }}
                            >
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 900,
                                fontFamily: cfg.fontLabel,
                                color: id === "neon" ? "#00ffff"
                                  : id === "fire" ? "#ffaa00"
                                  : id === "badge" ? "#38bdf8"
                                  : "#ffffff",
                                textShadow: id === "neon" ? "0 0 8px #00ffff" : "none",
                              }}>
                                {cfg.preview}
                              </span>
                              <span style={{ fontSize: 9, opacity: 0.65 }}>{cfg.label}</span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>

                  {/* Hook Decor Selector */}
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Decorador del gancho</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {HOOK_DECORS.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setHookDecor(d.id)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: hookDecor === d.id ? 700 : 400,
                            border: hookDecor === d.id
                              ? "1px solid #38bdf8"
                              : "1px solid rgba(255,255,255,0.1)",
                            background: hookDecor === d.id
                              ? "rgba(56,189,248,0.12)"
                              : "rgba(255,255,255,0.03)",
                            color: hookDecor === d.id ? "#38bdf8" : "rgba(255,255,255,0.7)",
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          {d.prefix || d.label}{d.prefix ? d.label : ""}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>
                      Duración en pantalla: {hookDuration.toFixed(1)}s
                    </label>
                    <div className={styles.rangeRow}>
                      <input
                        type="range"
                        className={styles.rangeInput}
                        min={1.5}
                        max={6.0}
                        step={0.5}
                        value={hookDuration}
                        onChange={(e) => setHookDuration(parseFloat(e.target.value))}
                      />
                      <span className={styles.rangeValue}>{hookDuration.toFixed(1)}s</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <hr className={styles.sectionDivider} />

            {/* ─── SECCIÓN: SUBTÍTULOS ─── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={`${styles.sectionIcon} ${styles.violet}`}>
                  <Captions size={13} />
                </div>
                <span className={styles.sectionTitle}>Subtítulos</span>
              </div>

              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Plantilla de subtítulos</label>
                {/* Gallery-style template grid inspired by CapCut */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "6px",
                  marginTop: "4px",
                }}>
                  {(Object.entries(THEME_CONFIG) as [SubTheme, { label: string; fontLabel: string; preview: string; desc: string }][]).map(
                    ([id, cfg]) => (
                      <button
                        key={id}
                        className={`${styles.themeBtn} ${subTheme === id ? styles.active : ""}`}
                        onClick={() => setSubTheme(id)}
                        title={cfg.desc}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                          padding: "8px 4px",
                          minHeight: "52px",
                        }}
                      >
                        <span style={{
                          fontSize: id === "none" ? "14px" : "10px",
                          fontWeight: ["hormozi", "cyberpunk", "neon"].includes(id) ? 900 : 400,
                          fontStyle: id === "classic" ? "italic" : "normal",
                          fontFamily: cfg.fontLabel || "inherit",
                          letterSpacing: ["hormozi", "cyberpunk"].includes(id) ? "-0.03em" : "normal",
                          color: id === "neon" ? "#00ffcc"
                            : id === "cyberpunk" ? "#ff0055"
                            : id === "duotone" ? "#a855f7"
                            : id === "podcast" ? "#38bdf8"
                            : "inherit",
                          textShadow: id === "neon" ? "0 0 8px #00ffcc" : "none",
                          lineHeight: 1.1,
                          whiteSpace: "pre",
                        }}>{cfg.preview}</span>
                        <span style={{ fontSize: 8, opacity: 0.65 }}>{cfg.label}</span>
                      </button>
                    )
                  )}
                </div>
              </div>

              {subTheme !== "none" && (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Paleta de color</label>
                    <div className={styles.colorSwatchGroup}>
                      {COLOR_PRESETS.map((cp, i) => (
                        <button
                          key={cp.label}
                          className={`${styles.colorSwatch} ${colorPresetIdx === i ? styles.selected : ""}`}
                          style={{ background: cp.highlight }}
                          title={cp.label}
                          onClick={() => setColorPresetIdx(i)}
                          aria-label={`Paleta ${cp.label}`}
                        />
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                      Color activo: <strong style={{ color: preset.highlight }}>{preset.label}</strong>
                    </div>
                  </div>

                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>
                      Posición vertical: {Math.round((marginV / 1920) * 100)}% desde abajo
                    </label>
                    <div className={styles.rangeRow}>
                      <input
                        type="range"
                        className={styles.rangeInput}
                        min={160}
                        max={520}
                        step={20}
                        value={marginV}
                        onChange={(e) => setMarginV(parseInt(e.target.value))}
                      />
                      <span className={styles.rangeValue}>{marginV}px</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      Sube para evitar la UI de TikTok / Reels (recomendado: 340–420px)
                    </div>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>

        {/* FOOTER */}
        <div className={styles.footer}>
          <div className={styles.footerMeta}>
            <div className={styles.footerMetaTitle}>
              {clip.title.length > 40 ? clip.title.slice(0, 40) + "…" : clip.title}
            </div>
            <div className={styles.footerMetaSub}>
              {duration}s · {mode.replace("_", " ")} · {subTheme}
            </div>
          </div>

          {/* Estado de renderizado */}
          {isRendering && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
              <div className={styles.progressLabel}>
                <Loader size={10} style={{ marginRight: 4, display: "inline" }} />
                {renderLabel}
              </div>
            </div>
          )}

          {renderSuccess && (
            <div className={styles.successBadge}>
              <CheckCircle size={14} />
              Descargado
            </div>
          )}

          {renderError && (
            <div className={styles.errorBadge} title={renderError}>
              {renderError}
            </div>
          )}

          <button
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={isRendering}
          >
            {isRendering ? (
              <>
                <Loader size={14} className="spin" />
                {renderProgress}%
              </>
            ) : (
              <>
                <Download size={14} />
                Exportar en Máxima Calidad
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
