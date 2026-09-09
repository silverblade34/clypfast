"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, Download, Pencil, MoreHorizontal, Copy, Check, ExternalLink, Sliders, X, Share2 } from "lucide-react";
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
  video_title?: string;
  video_channel?: string;
  channel?: string;
  video_source_url?: string;
}

interface Props {
  clip: Clip;
  index: number;
  isActive: boolean;
  onJump: (startSeconds: number) => void;
  videoId?: string;
  videoUrl?: string;
  videoTitle?: string;
  videoChannel?: string;
}

export function buildPostDescription({
  caption,
  reason,
  title,
  videoTitle,
  videoChannel,
  videoUrl,
  videoId,
  startSec,
  hashtags,
}: {
  caption?: string;
  reason?: string;
  title?: string;
  videoTitle?: string;
  videoChannel?: string;
  videoUrl?: string;
  videoId?: string;
  startSec?: number;
  hashtags?: string[] | string;
}): string {
  const text = (caption || title || "").trim();
  const lower = text.toLowerCase();

  const hasReflection = lower.includes("reflexión") || text.includes("💡");
  const hasVideo = lower.includes("video:") || text.includes("📌");
  const hasChannel = lower.includes("canal:") || text.includes("🎙");

  const blocks: string[] = [];

  // 1. Gancho principal (Hook)
  if (text) {
    blocks.push(text);
  }

  // 2. Pequeña reflexión (si no está ya integrada)
  if (!hasReflection && reason) {
    blocks.push(`💡 Reflexión: ${reason.trim()}`);
  }

  // 3. CTA si no tiene pregunta ni llamada
  if (
    !text.includes("?") &&
    !text.includes("¿") &&
    !lower.includes("opinas") &&
    !text.includes("👇")
  ) {
    blocks.push("¿Qué opinas tú de esto? ¡Déjame tu punto de vista en los comentarios! 👇");
  }

  // 4. Mención de la fuente (Video y Canal)
  const sourceLines: string[] = [];
  if (!hasVideo && videoTitle) {
    sourceLines.push(`📌 Video: ${videoTitle}`);
  }
  if (!hasChannel && videoChannel) {
    sourceLines.push(`🎙 Canal: ${videoChannel}`);
  }
  if (videoId && startSec !== undefined) {
    sourceLines.push(`🔗 https://youtu.be/${videoId}?t=${Math.floor(startSec)}`);
  } else if (videoUrl && !text.includes("http")) {
    sourceLines.push(`🔗 ${videoUrl}`);
  }

  if (sourceLines.length > 0) {
    blocks.push(sourceLines.join("\n"));
  }

  // 5. Hashtags
  if (hashtags) {
    const tagList = Array.isArray(hashtags)
      ? hashtags
      : typeof hashtags === "string"
      ? hashtags.split(/\s+/)
      : [];
    const formattedTags = tagList
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .join(" ");
    if (formattedTags && !text.includes(formattedTags)) {
      blocks.push(formattedTags);
    }
  }

  return blocks.join("\n\n").trim();
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

export default function ClipCard({ clip, index, isActive, onJump, videoId, videoUrl, videoTitle, videoChannel }: Props) {
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
  const effectiveVideoTitle = videoTitle || clip.video_title;
  const effectiveChannel = videoChannel || clip.video_channel || clip.channel;

  // Direct YouTube CDN snapshot (0% server load, instant 20ms load from Google Edge CDN)
  const thumbIndex = (index % 3) + 1;
  const primaryThumb = effectiveVideoId
    ? `https://img.youtube.com/vi/${effectiveVideoId}/${thumbIndex}.jpg`
    : clip.id
      ? `/api/clips/${clip.id}/thumbnail`
      : null;

  const [thumbSrc, setThumbSrc] = useState<string | null>(primaryThumb);
  const [thumbLoaded, setThumbLoaded] = useState(false);

  // Sync inputs when startSec/endSec change
  useEffect(() => {
    setStartTimeInput(formatTime(startSec));
    setEndTimeInput(formatTime(endSec));
  }, [startSec, endSec]);

  // Extract clean hook quote, reflection and attribution
  let quoteText = "";
  let reflectionText = clip.reason || "";

  if (clip.caption) {
    const cleanCap = clip.caption.replace(/#[a-zA-Z0-9_-]+/g, "").trim();
    const reflectionMatch = cleanCap.match(/(?:💡\s*)?[Rr]eflexi[oó]n:\s*([^📌🎙\n]+(?:\n[^📌🎙\n]+)*)/);
    if (reflectionMatch) {
      reflectionText = reflectionMatch[1].trim();
      const beforeRef = cleanCap.split(/(?:💡\s*)?[Rr]eflexi[oó]n:/)[0].trim();
      quoteText = beforeRef;
    } else {
      const paragraphs = cleanCap.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const nonAttribution = paragraphs.filter((p) => !p.startsWith("📌") && !p.startsWith("🎙"));
      if (nonAttribution.length >= 2 && !clip.reason) {
        quoteText = nonAttribution[0];
        reflectionText = nonAttribution.slice(1).join("\n\n");
      } else {
        quoteText = nonAttribution[0] || cleanCap;
      }
    }
  } else if (clip.title) {
    quoteText = `“${clip.title}”`;
  }

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

  const getFullPostCopy = () => {
    return buildPostDescription({
      caption: clip.caption,
      reason: clip.reason,
      title: clip.title,
      videoTitle: effectiveVideoTitle,
      videoChannel: effectiveChannel,
      videoUrl,
      videoId: effectiveVideoId ?? undefined,
      startSec,
      hashtags: clip.hashtags,
    });
  };

  const handleCopyText = () => {
    const fullText = getFullPostCopy();
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
            {!thumbLoaded && <div className={styles.skeletonShimmer} />}
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={clip.title}
                className={`${styles.thumb} ${thumbLoaded ? styles.thumbVisible : styles.thumbHidden}`}
                loading="lazy"
                onLoad={() => setThumbLoaded(true)}
                onError={() => {
                  // Fallback to YouTube snapshot
                  if (effectiveVideoId && thumbSrc !== `https://img.youtube.com/vi/${effectiveVideoId}/1.jpg`) {
                    setThumbSrc(`https://img.youtube.com/vi/${effectiveVideoId}/1.jpg`);
                  } else if (effectiveVideoId) {
                    setThumbSrc(`https://img.youtube.com/vi/${effectiveVideoId}/mqdefault.jpg`);
                  }
                  setThumbLoaded(true);
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

            {/* Reflection / Takeaway */}
            {reflectionText && (
              <p className={styles.reasonText}>
                <span className={styles.reflectionTag}>💡 Reflexión</span>
                {reflectionText}
              </p>
            )}

            {/* Source Video & Channel attribution */}
            {(effectiveVideoTitle || effectiveChannel) && (
              <div className={styles.sourceAttribution}>
                {effectiveVideoTitle && (
                  <span className={styles.sourceItem} title={`Video original: ${effectiveVideoTitle}`}>
                    <span className={styles.sourceIcon}>📌</span> {effectiveVideoTitle}
                  </span>
                )}
                {effectiveChannel && (
                  <span className={styles.sourceItem} title={`Canal / Creador: ${effectiveChannel}`}>
                    <span className={styles.sourceIcon}>🎙</span> {effectiveChannel}
                  </span>
                )}
              </div>
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

              {/* 2. Editar (Mini-CapCut Studio) — temporalmente oculto */}
              {/* <button
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
              </button> */}

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
                        setShowCopyBox(!showCopyBox);
                        setShowMoreMenu(false);
                      }}
                    >
                      <Share2 size={12} />
                      <span>{showCopyBox ? "Ocultar descripción" : "Ver descripción para post"}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.dropdownItem}
                      onClick={() => {
                        handleCopyText();
                        setShowMoreMenu(false);
                      }}
                    >
                      <Copy size={12} />
                      <span>Copiar post (con reflexión y fuente)</span>
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
        {showCopyBox && (
          <div className={styles.socialCopyBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#38bdf8", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  <span>📱</span> Descripción sugerida para redes sociales:
                </div>
                <pre className={styles.copyPreBlock}>{getFullPostCopy()}</pre>
              </div>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleCopyText}
                style={{ fontSize: 11, padding: "6px 12px", whiteSpace: "nowrap", alignSelf: "flex-start" }}
              >
                {copiedCopy ? <><Check size={11} color="#4ade80" /> Copiado</> : <><Copy size={11} /> Copiar texto</>}
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
