"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, Download, Pencil, MoreHorizontal, Copy, Check, ExternalLink, Sliders, X } from "lucide-react";
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
  hashtags?: string | string[];
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

function parseTimeToSeconds(timeStr: string): number | null {
  const parts = timeStr.trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

function extractYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Deriva tags temáticos inteligentes acordes al mockup
 */
function deriveTags(hashtags?: string | string[], title?: string, reason?: string): string[] {
  let list: string[] = [];
  if (hashtags) {
    list = Array.isArray(hashtags)
      ? hashtags
      : typeof hashtags === "string"
        ? hashtags.split(/[\s,]+/)
        : [];
  }
  const clean = list
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.replace(/^#/, "").replace(/([A-Z])/g, " $1").trim())
    .filter(Boolean);

  if (clean.length > 0) {
    return clean.slice(0, 3);
  }

  // Tags contextuales automáticos
  const text = `${title || ""} ${reason || ""}`.toLowerCase();
  const tags: string[] = [];
  if (text.includes("ia") || text.includes("inteligencia") || text.includes("código") || text.includes("dev") || text.includes("software") || text.includes("tech")) {
    tags.push("Tecnología");
  }
  if (text.includes("negocio") || text.includes("empresa") || text.includes("startup") || text.includes("dinero") || text.includes("ventas")) {
    tags.push("Negocios");
  }
  if (text.includes("debate") || text.includes("polémica") || text.includes("injusticia") || text.includes("critica") || text.includes("muerte") || text.includes("supera")) {
    tags.push("Controversial");
  }
  if (text.includes("aprender") || text.includes("tutorial") || text.includes("consejo") || text.includes("explicación") || text.includes("cómo")) {
    tags.push("Educativo");
  }
  if (text.includes("viral") || text.includes("tendencia") || text.includes("secreto") || text.includes("increíble")) {
    tags.push("Tendencia");
  }
  if (tags.length === 0) tags.push("Destacado", "Viral");
  return tags.slice(0, 3);
}

export default function ClipCard({ clip, index, isActive, onJump, videoId, videoUrl }: Props) {
  const router = useRouter();
  const [startSec, setStartSec] = useState(clip.start_seconds);
  const [endSec, setEndSec] = useState(clip.end_seconds);
  const [status, setStatus] = useState(clip.status || "prospecto");

  // Time editing state (supports MM:SS format)
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [startTimeInput, setStartTimeInput] = useState(formatTime(clip.start_seconds));
  const [endTimeInput, setEndTimeInput] = useState(formatTime(clip.end_seconds));
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showCopyBox, setShowCopyBox] = useState(false);

  // Modal personalización
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [customizerMode, setCustomizerMode] = useState<"smart_vertical" | "vertical_blur" | "original" | "split_screen">("smart_vertical");

  // Feedback
  const [copiedCopy, setCopiedCopy] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const duration = Math.round(endSec - startSec);
  const tags = deriveTags(clip.hashtags, clip.title, clip.reason);

  const effectiveVideoId = videoId || extractYouTubeId(videoUrl);

  // Use exact clip frame thumbnail from backend with fallback to YouTube snapshot
  const primaryThumb = clip.id
    ? `/api/clips/${clip.id}/thumbnail`
    : effectiveVideoId
      ? `https://img.youtube.com/vi/${effectiveVideoId}/1.jpg`
      : null;

  const [thumbSrc, setThumbSrc] = useState<string | null>(primaryThumb);

  // Sync inputs when startSec/endSec change
  useEffect(() => {
    setStartTimeInput(formatTime(startSec));
    setEndTimeInput(formatTime(endSec));
  }, [startSec, endSec]);

  // Extract clean hook quote from caption
  const rawCaption = clip.caption ? clip.caption.replace(/#[a-zA-Z0-9_-]+/g, "").trim() : "";
  const quoteText = rawCaption || (clip.title ? `“${clip.title}”` : "");

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoreMenu]);

  const handleStartTimeChange = (val: string) => {
    setStartTimeInput(val);
    const parsed = parseTimeToSeconds(val);
    if (parsed !== null && parsed >= 0 && parsed < endSec) {
      setStartSec(parsed);
    }
  };

  const handleEndTimeChange = (val: string) => {
    setEndTimeInput(val);
    const parsed = parseTimeToSeconds(val);
    if (parsed !== null && parsed > startSec) {
      setEndSec(parsed);
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
      } catch {}
    }
    setIsSavingTime(false);
    setIsEditingTime(false);
  };

  const handleCopyText = () => {
    const fullText = `${clip.caption || clip.title}\n\n${
      Array.isArray(clip.hashtags) ? clip.hashtags.join(" ") : clip.hashtags || ""
    }`.trim();
    navigator.clipboard.writeText(fullText);
    setCopiedCopy(true);
    setTimeout(() => setCopiedCopy(false), 2500);
  };

  const handleCopyLink = () => {
    if (!effectiveVideoId) return;
    const url = `https://youtu.be/${effectiveVideoId}?t=${Math.floor(startSec)}`;
    navigator.clipboard.writeText(url);
    setShowMoreMenu(false);
  };

  return (
    <>
      <div
        className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
        id={`clip-card-${index}`}
      >
        <div className={styles.mainRow}>
          {/* Circular Index Badge */}
          <div className={styles.indexBadge}>{index + 1}</div>

          {/* Video Thumbnail with exact moment frame & timestamp pill */}
          <div
            className={styles.thumbWrapper}
            onClick={() => onJump(startSec)}
            title="Reproducir este momento"
          >
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={clip.title}
                className={styles.thumb}
                loading="lazy"
                onError={() => {
                  // Fallback to YouTube snapshot
                  if (effectiveVideoId && thumbSrc !== `https://img.youtube.com/vi/${effectiveVideoId}/1.jpg`) {
                    setThumbSrc(`https://img.youtube.com/vi/${effectiveVideoId}/1.jpg`);
                  } else if (effectiveVideoId) {
                    setThumbSrc(`https://img.youtube.com/vi/${effectiveVideoId}/mqdefault.jpg`);
                  }
                }}
              />
            ) : (
              <div className={styles.thumbPlaceholder}>▶</div>
            )}
            <div className={styles.thumbPlayOverlay}>
              <Play size={20} fill="currentColor" />
            </div>
            {/* Timestamp Badge overlaid on thumbnail */}
            <div className={styles.thumbTimeBadge}>
              {formatTime(startSec)} – {formatTime(endSec)}
            </div>
          </div>

          {/* Right Content Block */}
          <div className={styles.content}>
            {/* Top Row: Title + Score Pill */}
            <div className={styles.headerRow}>
              <h3 className={styles.title}>{clip.title}</h3>
              <div
                className={`${styles.scorePill} ${clip.score >= 9 ? styles.scorePillGold : ""}`}
                title={`Score de viralidad estimado: ${clip.score}/10`}
              >
                <span>🔥</span>
                <span>{clip.score}/10</span>
              </div>
            </div>

            {/* Category Tags Row */}
            {tags.length > 0 && (
              <div className={styles.tagsRow}>
                {tags.map((tag) => (
                  <span key={tag} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Hook Quote Line */}
            {quoteText && (
              <p className={styles.quoteBox}>
                <span className={styles.quoteHighlight}>“</span>
                {quoteText.replace(/^“|”$/g, "").trim()}
                <span className={styles.quoteHighlight}>”</span>
              </p>
            )}

            {/* Reason / Explanation */}
            {clip.reason && (
              <p className={styles.reasonText}>
                {clip.reason}
              </p>
            )}

            {/* Action Buttons Row */}
            <div className={styles.actionsRow}>
              {/* 1. Ver clip (Filled Blue) */}
              <button
                type="button"
                className={`${styles.jumpBtn} ${isActive ? styles.jumpBtnActive : ""}`}
                onClick={() => onJump(startSec)}
                id={`jump-btn-${index}`}
              >
                <Play size={12} fill="currentColor" />
                <span>{isActive ? "Reproduciendo" : "Ver clip"}</span>
              </button>

              {/* 2. Editar (Mini-CapCut Studio) */}
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => {
                  const payload = {
                    clip: {
                      id: clip.id,
                      title: clip.title,
                      start_seconds: startSec,
                      end_seconds: endSec,
                      reason: clip.reason,
                      score: clip.score,
                      status: status,
                      caption: clip.caption,
                      hashtags: clip.hashtags,
                    },
                    index,
                    videoId: effectiveVideoId,
                    videoUrl: videoUrl || (effectiveVideoId ? `https://www.youtube.com/watch?v=${effectiveVideoId}` : ""),
                    returnUrl: typeof window !== "undefined" ? window.location.pathname : "/history",
                  };
                  try {
                    sessionStorage.setItem("clypfast_edit_clip", JSON.stringify(payload));
                  } catch {}

                  const sp = new URLSearchParams();
                  if (clip.id) sp.set("clipId", String(clip.id));
                  if (effectiveVideoId) sp.set("videoId", effectiveVideoId);
                  sp.set("start", String(startSec));
                  sp.set("end", String(endSec));
                  sp.set("index", String(index));
                  sp.set("title", clip.title);
                  if (typeof window !== "undefined") sp.set("returnUrl", window.location.pathname);
                  router.push(`/editor?${sp.toString()}`);
                }}
                title="Abrir en el editor Mini-CapCut"
                id={`edit-btn-${index}`}
              >
                <Pencil size={12} />
                <span>Editar</span>
              </button>

              {/* 3. Descargar (Personalizar 9:16) */}
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => {
                  setCustomizerMode("smart_vertical");
                  setShowCustomizer(true);
                }}
                id={`download-btn-${index}`}
                title="Exportar y descargar clip vertical"
              >
                <Download size={12} />
                <span>Descargar</span>
              </button>

              {/* 4. More Button */}
              <div style={{ position: "relative" }} ref={menuRef}>
                <button
                  type="button"
                  className={styles.moreBtn}
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  title="Más opciones"
                >
                  <MoreHorizontal size={14} />
                </button>

                {showMoreMenu && (
                  <div className={styles.dropdownMenu}>
                    <button
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        handleCopyText();
                        setShowMoreMenu(false);
                      }}
                    >
                      <Copy size={12} />
                      <span>Copiar copy y hashtags</span>
                    </button>
                    {effectiveVideoId && (
                      <button
                        type="button"
                        className={styles.dropdownItem}
                        onClick={handleCopyLink}
                      >
                        <ExternalLink size={12} />
                        <span>Copiar link con timestamp</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setIsEditingTime(!isEditingTime);
                        setShowMoreMenu(false);
                      }}
                    >
                      <Sliders size={12} />
                      <span>Ajustar rango ({formatTime(startSec)} – {formatTime(endSec)})</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Inline Time Editor con formato MM:SS y ajuste por segundos */}
        {isEditingTime && (
          <div className={styles.timeEditorCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sliders size={13} color="#38bdf8" />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#ffffff" }}>
                  Ajustar Minutos y Segundos del Clip
                </span>
              </div>
              <span
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: "#38bdf8",
                  background: "rgba(56, 189, 248, 0.12)",
                  padding: "2px 8px",
                  borderRadius: "99px",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                }}
              >
                ⏱ {formatTime(startSec)} – {formatTime(endSec)} ({duration}s)
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Inicio Block */}
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
                <label style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.6)", display: "block", marginBottom: 6, fontWeight: 500 }}>
                  Inicio (Minutos : Segundos)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setStartSec(Math.max(0, startSec - 5))}
                    className={styles.stepperBtn}
                    title="-5 segundos"
                  >
                    -5s
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartSec(Math.max(0, startSec - 1))}
                    className={styles.stepperBtn}
                    title="-1 segundo"
                  >
                    -1s
                  </button>
                  <input
                    type="text"
                    value={startTimeInput}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    placeholder="MM:SS"
                    className="input-field"
                    style={{
                      width: "66px",
                      textAlign: "center",
                      padding: "4px 6px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#38bdf8",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setStartSec(Math.min(endSec - 2, startSec + 1))}
                    className={styles.stepperBtn}
                    title="+1 segundo"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartSec(Math.min(endSec - 2, startSec + 5))}
                    className={styles.stepperBtn}
                    title="+5 segundos"
                  >
                    +5s
                  </button>
                </div>
              </div>

              {/* Fin Block */}
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
                <label style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.6)", display: "block", marginBottom: 6, fontWeight: 500 }}>
                  Fin (Minutos : Segundos)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setEndSec(Math.max(startSec + 2, endSec - 5))}
                    className={styles.stepperBtn}
                    title="-5 segundos"
                  >
                    -5s
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndSec(Math.max(startSec + 2, endSec - 1))}
                    className={styles.stepperBtn}
                    title="-1 segundo"
                  >
                    -1s
                  </button>
                  <input
                    type="text"
                    value={endTimeInput}
                    onChange={(e) => handleEndTimeChange(e.target.value)}
                    placeholder="MM:SS"
                    className="input-field"
                    style={{
                      width: "66px",
                      textAlign: "center",
                      padding: "4px 6px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#c084fc",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setEndSec(endSec + 1)}
                    className={styles.stepperBtn}
                    title="+1 segundo"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndSec(endSec + 5)}
                    className={styles.stepperBtn}
                    title="+5 segundos"
                  >
                    +5s
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setIsEditingTime(false)}
                className={styles.actionBtn}
                style={{ fontSize: "11.5px", padding: "5px 12px" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveTimes}
                disabled={isSavingTime}
                className="btn-primary"
                style={{ fontSize: "11.5px", padding: "5px 16px" }}
              >
                {isSavingTime ? "Guardando..." : "✓ Guardar cambios"}
              </button>
            </div>
          </div>
        )}

        {/* Social Copy Box */}
        {(clip.caption || clip.hashtags) && showCopyBox && (
          <div className={styles.socialCopyBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {clip.caption && <p className={styles.quoteBox}>"{clip.caption}"</p>}
                {clip.hashtags && (
                  <p style={{ color: "#a78bfa", marginTop: 4, fontSize: 11 }}>
                    {Array.isArray(clip.hashtags) ? clip.hashtags.join(" ") : clip.hashtags}
                  </p>
                )}
              </div>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleCopyText}
                style={{ fontSize: 11, padding: "4px 8px" }}
              >
                {copiedCopy ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar</>}
              </button>
            </div>
          </div>
        )}

        {/* Success badge when exported */}
        {exportSuccess && (
          <div className={styles.successBadge}>
            <Check size={13} />
            <span>¡Clip exportado y listo!</span>
          </div>
        )}
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
