"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./ClipCard.module.css";

export interface Clip {
  id?: number;
  start_seconds: number;
  end_seconds: number;
  title: string;
  reason: string;
  score: number;
  status?: string;
  caption?: string;
  hashtags?: string;
}

interface Props {
  clip: Clip;
  index: number;
  isActive: boolean;
  onJump: (startSeconds: number) => void;
  videoId?: string;
  videoUrl?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${(m % 60)
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getScoreClass(score: number): string {
  if (score >= 8) return "high";
  if (score >= 6) return "mid";
  return "low";
}

function getScoreEmoji(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 7) return "⚡";
  return "✨";
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  prospecto: { label: "Prospecto", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)" },
  enfoque_generado: { label: "9:16 Listo", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" },
  subtitulado: { label: "Subtitulado", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.15)" },
  en_revision: { label: "En Revisión", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" },
  publicado: { label: "Publicado", color: "#22c55e", bg: "rgba(34, 197, 94, 0.15)" },
  descartado: { label: "Descartado", color: "#64748b", bg: "rgba(100, 116, 139, 0.12)" },
};

export default function ClipCard({
  clip,
  index,
  isActive,
  onJump,
  videoId,
  videoUrl,
}: Props) {
  const [startSec, setStartSec] = useState(clip.start_seconds);
  const [endSec, setEndSec] = useState(clip.end_seconds);
  const [status, setStatus] = useState(clip.status || "prospecto");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isSavingTime, setIsSavingTime] = useState(false);

  // Subtitle options
  const [subtitleTheme, setSubtitleTheme] = useState<"hormozi" | "minimal" | "cyberpunk" | "none">("hormozi");
  const [includeHookTitle, setIncludeHookTitle] = useState(true);
  const [normalizeAudio, setNormalizeAudio] = useState(true);

  // Menu & render states
  const [showMenu, setShowMenu] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderLabel, setRenderLabel] = useState("");
  const [renderSuccess, setRenderSuccess] = useState(false);
  const [renderError, setRenderError] = useState("");

  // Copy feedback
  const [copiedCopy, setCopiedCopy] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration = Math.round(endSec - startSec);
  const scoreClass = getScoreClass(clip.score);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus);
    if (!clip.id) return;
    try {
      await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      // ignore
    }
  };

  const handleSaveTimes = async () => {
    if (startSec >= endSec) return;
    setIsSavingTime(true);
    if (clip.id) {
      try {
        await fetch(`/api/clips/${clip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_seconds: startSec, end_seconds: endSec }),
        });
      } catch {
        // ignore
      }
    }
    setIsSavingTime(false);
    setIsEditingTime(false);
  };

  const handleCopyText = () => {
    const fullText = `${clip.caption || clip.title}\n\n${clip.hashtags || ""}`.trim();
    navigator.clipboard.writeText(fullText);
    setCopiedCopy(true);
    setTimeout(() => setCopiedCopy(false), 2500);
  };

  const handleDownload = async (
    mode: "smart_vertical" | "vertical_blur" | "original" | "split_screen"
  ) => {
    setShowMenu(false);
    setRenderError("");
    setIsRendering(true);
    setRenderProgress(10);
    setRenderLabel("Iniciando procesamiento...");

    const targetUrl =
      videoUrl ||
      (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

    if (!targetUrl) {
      setRenderError("No se encontró la URL del video.");
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
          title: clip.title,
          mode: mode,
          subtitle_theme: subtitleTheme,
          include_hook_title: includeHookTitle,
          normalize_audio: normalizeAudio,
          clip_id: clip.id,
        }),
      });

      if (!res.ok) {
        throw new Error("No se pudo iniciar el renderizado del clip.");
      }

      const { render_id } = await res.json();

      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/clips/render-status/${render_id}`);
          if (!statusRes.ok) return;

          const data = await statusRes.json();
          setRenderProgress(data.progress || 0);
          setRenderLabel(data.step_label || "Procesando clip...");

          if (data.status === "done") {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setIsRendering(false);
            setRenderSuccess(true);
            setStatus(subtitleTheme !== "none" ? "subtitulado" : "enfoque_generado");

            const a = document.createElement("a");
            a.href = `/api/clips/download/${data.filename}`;
            a.download = data.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => setRenderSuccess(false), 4500);
          } else if (data.status === "error") {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setIsRendering(false);
            setRenderError(data.error || "Ocurrió un error al procesar.");
          }
        } catch {
          // ignore
        }
      }, 1000);
    } catch (err: any) {
      setIsRendering(false);
      setRenderError(err.message || "Error al conectar con el servidor.");
    }
  };

  const statusMeta = STATUS_CONFIG[status] || STATUS_CONFIG.prospecto;

  return (
    <div
      className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
      id={`clip-card-${index}`}
    >
      {/* Top row: Index, Status Selector, Viral Score */}
      <div className={styles.header}>
        <div className={styles.indexBadge}>{index + 1}</div>

        <div className={styles.titleGroup}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {/* Status Dropdown */}
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={styles.statusSelect}
              style={{ color: statusMeta.color, background: statusMeta.bg }}
            >
              <option value="prospecto">⚪ Prospecto</option>
              <option value="enfoque_generado">🔵 9:16 Listo</option>
              <option value="subtitulado">🟣 Subtitulado</option>
              <option value="en_revision">🟠 En Revisión</option>
              <option value="publicado">🟢 Publicado</option>
              <option value="descartado">⚪ Descartado</option>
            </select>
          </div>

          <h3 className={styles.title}>{clip.title}</h3>

          <div className={styles.meta}>
            <span className={styles.timestamp}>
              ⏱ {formatTime(startSec)} → {formatTime(endSec)}
            </span>
            <span className={styles.duration}>{duration}s</span>

            <button
              type="button"
              className={styles.adjustBtn}
              onClick={() => setIsEditingTime(!isEditingTime)}
              title="Ajustar inicio y fin del clip"
            >
              ⚙ Ajustar tiempos
            </button>
          </div>
        </div>

        <div className={`score-badge ${scoreClass} ${styles.scoreBadge}`}>
          <span>{getScoreEmoji(clip.score)}</span>
          <span>{clip.score}/10</span>
        </div>
      </div>

      {/* Inline fine-tune time editor */}
      {isEditingTime && (
        <div className={styles.timeEditorCard}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block" }}>Inicio (seg):</label>
              <input
                type="number"
                step="0.5"
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value) || 0)}
                className="input-field"
                style={{ width: 90, padding: "4px 8px", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block" }}>Fin (seg):</label>
              <input
                type="number"
                step="0.5"
                value={endSec}
                onChange={(e) => setEndSec(parseFloat(e.target.value) || 0)}
                className="input-field"
                style={{ width: 90, padding: "4px 8px", fontSize: 13 }}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ padding: "6px 14px", fontSize: 12, marginTop: 14 }}
              onClick={handleSaveTimes}
              disabled={isSavingTime}
            >
              {isSavingTime ? "Guardando..." : "✓ Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* Reason */}
      <p className={styles.reason}>{clip.reason}</p>

      {/* Caption & Hashtags preview drawer */}
      {(clip.caption || clip.hashtags) && (
        <div className={styles.socialCopyBox}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1 }}>
              {clip.caption && <p className={styles.captionText}>"{clip.caption}"</p>}
              {clip.hashtags && <p className={styles.hashtagsText}>{clip.hashtags}</p>}
            </div>
            <button
              type="button"
              onClick={handleCopyText}
              className={styles.copyBtn}
              title="Copiar Copy y Hashtags al portapapeles"
            >
              {copiedCopy ? "✓ ¡Copiado!" : "📋 Copiar Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Rendering progress indicator */}
      {isRendering && (
        <div className={styles.renderProgressContainer}>
          <div className={styles.renderProgressBar}>
            <div
              className={styles.renderProgressFill}
              style={{ width: `${renderProgress}%` }}
            />
          </div>
          <div className={styles.renderProgressMeta}>
            <span className="spinner spinner-sm" />
            <span className={styles.renderLabelText}>{renderLabel}</span>
            <span className={styles.renderPctText}>{renderProgress}%</span>
          </div>
        </div>
      )}

      {/* Success notification */}
      {renderSuccess && (
        <div className={styles.successBadge}>
          <span>✓</span>
          <span>¡Clip descargado en tu equipo con subtítulos y audio optimizado!</span>
        </div>
      )}

      {/* Error notification */}
      {renderError && (
        <div className={styles.errorBadge}>
          <span>⚠️</span>
          <span>{renderError}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className={styles.actionsRow}>
        <button
          className={`${styles.jumpBtn} ${isActive ? styles.jumpBtnActive : ""}`}
          onClick={() => onJump(startSec)}
          id={`jump-btn-${index}`}
        >
          <span>▶</span>
          <span>{isActive ? "Reproduciendo..." : "Saltar al clip"}</span>
        </button>

        {/* Download Clip Menu */}
        <div className={styles.downloadWrapper} ref={menuRef}>
          <button
            type="button"
            className={`${styles.downloadBtn} ${isRendering ? styles.downloadBtnDisabled : ""}`}
            onClick={() => !isRendering && setShowMenu(!showMenu)}
            disabled={isRendering}
            id={`download-btn-${index}`}
            title="Descargar clip con subtítulos y formato vertical"
          >
            <span>📥</span>
            <span>{isRendering ? "Generando..." : "Descargar ▾"}</span>
          </button>

          {showMenu && (
            <div className={styles.dropdownMenu}>
              <div className={styles.dropdownHeader}>
                🎨 Opciones de Subtítulos y Audio
              </div>

              {/* Theme selection */}
              <div className={styles.themeSelectorGroup}>
                <label className={styles.configLabel}>Tema de Subtítulos:</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button
                    type="button"
                    className={`${styles.themeOptionBtn} ${subtitleTheme === "hormozi" ? styles.themeOptionActive : ""}`}
                    onClick={() => setSubtitleTheme("hormozi")}
                  >
                    🟡 Hormozi Pop
                  </button>
                  <button
                    type="button"
                    className={`${styles.themeOptionBtn} ${subtitleTheme === "minimal" ? styles.themeOptionActive : ""}`}
                    onClick={() => setSubtitleTheme("minimal")}
                  >
                    ⚪ Minimal Clean
                  </button>
                  <button
                    type="button"
                    className={`${styles.themeOptionBtn} ${subtitleTheme === "cyberpunk" ? styles.themeOptionActive : ""}`}
                    onClick={() => setSubtitleTheme("cyberpunk")}
                  >
                    🔥 Cyberpunk
                  </button>
                  <button
                    type="button"
                    className={`${styles.themeOptionBtn} ${subtitleTheme === "none" ? styles.themeOptionActive : ""}`}
                    onClick={() => setSubtitleTheme("none")}
                  >
                    🚫 Sin subtítulos
                  </button>
                </div>

                {/* Toggles */}
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={includeHookTitle}
                      onChange={(e) => setIncludeHookTitle(e.target.checked)}
                    />
                    <span>Incluir Título Gancho en primeros 3.5s</span>
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={normalizeAudio}
                      onChange={(e) => setNormalizeAudio(e.target.checked)}
                    />
                    <span>Normalizar volumen de audio (Loudnorm)</span>
                  </label>
                </div>
              </div>

              <div className={styles.dropdownHeader} style={{ marginTop: 6 }}>
                🎬 Formato de Exportación
              </div>

              {/* Nivel 2 & 3: Smart Vertical IA */}
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemFeatured}`}
                onClick={() => handleDownload("smart_vertical")}
              >
                <div className={styles.menuItemIcon}>📱</div>
                <div className={styles.menuItemText}>
                  <div className={styles.menuItemTitle}>
                    Vertical IA (Smart 9:16)
                    <span className={styles.badgeSparkle}>Nivel 3 ★</span>
                  </div>
                  <div className={styles.menuItemSub}>
                    Enfoca al orador con Face Tracking suave o divide pantalla en podcasts
                  </div>
                </div>
              </button>

              {/* Podcast Split Screen direct */}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => handleDownload("split_screen")}
              >
                <div className={styles.menuItemIcon}>🎙️</div>
                <div className={styles.menuItemText}>
                  <div className={styles.menuItemTitle}>
                    Podcast Split-Screen (9:16)
                  </div>
                  <div className={styles.menuItemSub}>
                    Pantalla dividida con ambos oradores apilados verticalmente
                  </div>
                </div>
              </button>

              {/* Nivel 1: Blur Background */}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => handleDownload("vertical_blur")}
              >
                <div className={styles.menuItemIcon}>🎬</div>
                <div className={styles.menuItemText}>
                  <div className={styles.menuItemTitle}>
                    Vertical Blur (9:16)
                  </div>
                  <div className={styles.menuItemSub}>
                    Video horizontal centrado con fondo desenfocado
                  </div>
                </div>
              </button>

              {/* Original 16:9 */}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => handleDownload("original")}
              >
                <div className={styles.menuItemIcon}>💻</div>
                <div className={styles.menuItemText}>
                  <div className={styles.menuItemTitle}>
                    Original (16:9)
                  </div>
                  <div className={styles.menuItemSub}>
                    Corte directo en calidad nativa horizontal
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {videoId && (
          <a
            href={`https://youtu.be/${videoId}?t=${Math.floor(startSec)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ytExtLink}
            title="Abrir este momento directamente en YouTube"
          >
            ↗ YouTube
          </a>
        )}
      </div>
    </div>
  );
}
