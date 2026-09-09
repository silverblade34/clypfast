"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Download, Pencil, MoreHorizontal, Copy, Check, ChevronDown } from "lucide-react";
import styles from "./ClipCard.module.css";
import ClipCustomizerModal from "./ClipCustomizerModal";

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
    return `${h.toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getScoreClass(score: number): string {
  if (score >= 8) return "high";
  if (score >= 6) return "mid";
  return "low";
}

function getScoreIcon(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 7) return "⚡";
  return "✨";
}

/**
 * Deriva tags de contexto a partir de los hashtags del clip.
 * Toma los primeros 3 hashtags, limpia el # y capitaliza.
 * Si no hay hashtags, devuelve un array vacío.
 */
function deriveTags(hashtags?: string): string[] {
  if (!hashtags) return [];
  return hashtags
    .split(/[\s,]+/)
    .filter((t) => t.startsWith("#"))
    .slice(0, 3)
    .map((t) => t.replace(/^#/, "").replace(/([A-Z])/g, " $1").trim());
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  prospecto:        { label: "Prospecto",   color: "#64748b", dot: "#475569" },
  enfoque_generado: { label: "9:16 Listo",  color: "#38bdf8", dot: "#38bdf8" },
  subtitulado:      { label: "Subtitulado", color: "#a78bfa", dot: "#a78bfa" },
  en_revision:      { label: "En Revisión", color: "#f59e0b", dot: "#f59e0b" },
  publicado:        { label: "Publicado",   color: "#22c55e", dot: "#22c55e" },
  descartado:       { label: "Descartado",  color: "#475569", dot: "#334155" },
};

export default function ClipCard({ clip, index, isActive, onJump, videoId, videoUrl }: Props) {
  const [startSec, setStartSec] = useState(clip.start_seconds);
  const [endSec, setEndSec]     = useState(clip.end_seconds);
  const [status, setStatus]     = useState(clip.status || "prospecto");

  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isSavingTime,  setIsSavingTime]  = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showCopyBox, setShowCopyBox] = useState(false);

  // Modal personalización (Fase 2)
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [customizerMode, setCustomizerMode] = useState<"smart_vertical" | "vertical_blur" | "original" | "split_screen">("smart_vertical");

  // Feedback
  const [copiedCopy, setCopiedCopy]     = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const statusRef  = useRef<HTMLDivElement>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration   = Math.round(endSec - startSec);
  const scoreClass = getScoreClass(clip.score);
  const tags       = deriveTags(clip.hashtags);
  const statusMeta = STATUS_CONFIG[status] || STATUS_CONFIG.prospecto;

  // Thumbnail YouTube: usa la imagen del video (no exactamente el timestamp, pero identifica el video)
  const thumbSrc = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : null;

  // Cerrar status menu al click fuera
  useEffect(() => {
    if (!showStatusMenu) return;
    const handler = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStatusMenu]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus);
    setShowStatusMenu(false);
    if (!clip.id) return;
    try {
      await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch { /* ignore */ }
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
      } catch { /* ignore */ }
    }
    setIsSavingTime(false);
    setIsEditingTime(false);
  };

  const handleCopyText = () => {
    const text = `${clip.caption || clip.title}\n\n${clip.hashtags || ""}`.trim();
    navigator.clipboard.writeText(text);
    setCopiedCopy(true);
    setTimeout(() => setCopiedCopy(false), 2500);
  };

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <>
    <div
      className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
      id={`clip-card-${index}`}
    >
      {/* Score badge — esquina superior derecha */}
      <div className={`${styles.scoreBadge} ${styles[scoreClass]}`}>
        <span>{getScoreIcon(clip.score)}</span>
        <span>{clip.score}/10</span>
      </div>

      {/* MAIN ROW: index · thumbnail · content */}
      <div className={styles.mainRow}>

        {/* Número */}
        <div className={styles.indexBadge}>{index + 1}</div>

        {/* Thumbnail */}
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbSrc} alt="" className={styles.thumb} loading="lazy" />
        ) : (
          <div className={styles.thumbPlaceholder}>▶</div>
        )}

        {/* Contenido */}
        <div className={styles.content}>
          {/* Status pill clickeable */}
          <div ref={statusRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              className={styles.statusPill}
              style={{
                color: statusMeta.color,
                background: `${statusMeta.color}18`,
                borderColor: `${statusMeta.color}30`,
              }}
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              title="Cambiar estado"
            >
              <span
                className={styles.statusDot}
                style={{ background: statusMeta.dot }}
              />
              {statusMeta.label}
              <ChevronDown size={9} style={{ marginLeft: 2 }} />
            </button>

            {showStatusMenu && (
              <div className={styles.statusDropdown}>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={styles.statusOption}
                    onClick={() => handleStatusChange(key)}
                  >
                    <span className={styles.statusDot} style={{ background: cfg.dot }} />
                    {cfg.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Título */}
          <h3 className={styles.title}>{clip.title}</h3>

          {/* Tiempo */}
          <div className={styles.timeRow}>
            <span className={styles.timestamp}>
              {formatTime(startSec)} → {formatTime(endSec)}
            </span>
            <span className={styles.duration}>{duration}s</span>
            <button
              className={styles.adjustBtn}
              onClick={() => setIsEditingTime(!isEditingTime)}
              title="Ajustar inicio y fin"
            >
              <Pencil size={9} />
              Ajustar
            </button>
          </div>
        </div>
      </div>

      {/* TAGS ROW */}
      {tags.length > 0 && (
        <div className={styles.tagsRow}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )}

      {/* DESCRIPTION */}
      <p className={styles.reason}>{clip.reason}</p>

      {/* INLINE TIME EDITOR */}
      {isEditingTime && (
        <div className={styles.timeEditorCard}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                Inicio (seg)
              </label>
              <input
                type="number"
                step="0.5"
                value={startSec}
                onChange={(e) => setStartSec(parseFloat(e.target.value) || 0)}
                className="input-field"
                style={{ width: 86, padding: "4px 8px", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                Fin (seg)
              </label>
              <input
                type="number"
                step="0.5"
                value={endSec}
                onChange={(e) => setEndSec(parseFloat(e.target.value) || 0)}
                className="input-field"
                style={{ width: 86, padding: "4px 8px", fontSize: 12 }}
              />
            </div>
            <button
              className="btn-primary"
              style={{ padding: "6px 12px", fontSize: 11, marginTop: 14 }}
              onClick={handleSaveTimes}
              disabled={isSavingTime}
            >
              {isSavingTime ? "Guardando..." : "✓ Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* CAPTION COPY (colapsable) */}
      {(clip.caption || clip.hashtags) && showCopyBox && (
        <div className={styles.socialCopyBox}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {clip.caption && <p className={styles.captionText}>"{clip.caption}"</p>}
              {clip.hashtags && <p className={styles.hashtagsText}>{clip.hashtags}</p>}
            </div>
            <button className={styles.copyBtn} onClick={handleCopyText}>
              {copiedCopy ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar</>}
            </button>
          </div>
        </div>
      )}

      {/* SUCCESS BADGE */}
      {exportSuccess && (
        <div className={styles.successBadge}>
          <Check size={13} />
          ¡Clip exportado y descargado!
        </div>
      )}

      {/* ACTION BUTTONS ROW */}
      <div className={styles.actionsRow}>

        {/* Ver clip */}
        <button
          className={`${styles.jumpBtn} ${isActive ? styles.jumpBtnActive : ""}`}
          onClick={() => onJump(startSec)}
          id={`jump-btn-${index}`}
        >
          <Play size={12} fill="currentColor" />
          {isActive ? "Reproduciendo" : "Ver clip"}
        </button>

        {/* Editar (abre time editor + copy) */}
        <button
          className={styles.editBtn}
          onClick={() => {
            setIsEditingTime(!isEditingTime);
            setShowCopyBox(!showCopyBox);
          }}
          title="Editar tiempos y copy"
        >
          <Pencil size={12} />
          Editar
        </button>

        {/* Descargar → abre modal Fase 2 */}
        <div className={styles.downloadWrapper}>
          <button
            className={styles.downloadBtn}
            onClick={() => {
              setCustomizerMode("smart_vertical");
              setShowCustomizer(true);
            }}
            id={`download-btn-${index}`}
            title="Personalizar y descargar clip"
          >
            <Download size={12} />
            Descargar
          </button>
        </div>

        {/* Más opciones */}
        <button
          className={styles.moreBtn}
          onClick={() => setShowCopyBox(!showCopyBox)}
          title="Ver copy y hashtags"
        >
          <MoreHorizontal size={14} />
        </button>

        {/* YouTube link */}
        {videoId && (
          <a
            href={`https://youtu.be/${videoId}?t=${Math.floor(startSec)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ytExtLink}
            title="Abrir en YouTube"
          >
            ↗ YouTube
          </a>
        )}
      </div>
    </div>

    {/* Modal de Personalización – Fase 2 */}
    {showCustomizer && (
      <ClipCustomizerModal
        clip={{ ...clip, start_seconds: startSec, end_seconds: endSec }}
        index={index}
        videoId={videoId}
        videoUrl={videoUrl}
        initialMode={customizerMode}
        onClose={() => setShowCustomizer(false)}
        onExportDone={(newStatus) => {
          setStatus(newStatus);
          setShowCustomizer(false);
          setExportSuccess(true);
          setTimeout(() => setExportSuccess(false), 5000);
        }}
      />
    )}
    </>
  );
}
