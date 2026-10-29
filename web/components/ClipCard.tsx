"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, Download, Pencil, MoreHorizontal, Copy, Check, ExternalLink, Sliders, X, Share2, Sparkles } from "lucide-react";
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
  // Stage 2: Social Content Analysis
  stage2_done?: boolean;
  core_idea?: string;
  surface_topic?: string;
  hidden_angle?: string;
  hook?: string;
  alternative_hooks?: string[];
  quote?: string;
  social_description?: string;
  engagement_question?: string;
  social_score?: number;
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
  isNewlyAdded?: boolean;
}

export function toFirstPersonReflection(reason?: string, title?: string): string {
  // Deprecated: reflexiones automáticas eliminadas por falta de redacción humana.
  return "";
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
  let text = (caption || title || "").trim();

  // Strip any old robotic reflection blocks from existing captions
  text = text
    .replace(/(?:^|\n)\s*(?:💡\s*)?[Rr]eflexi[oó]n:[\s\S]*?(?=\n\n|\n📌|\n🎙|\n¿|$)/g, "")
    .trim();

  const hasVideo = /(?:^|\n)\s*📌\s*video:/i.test(text);
  const hasChannel = /(?:^|\n)\s*🎙\s*canal:/i.test(text);

  const blocks: string[] = [];

  // 1. Gancho principal (Hook)
  if (text) {
    blocks.push(text);
  }

  // 2. CTA si no tiene pregunta ni llamada
  if (
    !text.includes("?") &&
    !text.includes("¿") &&
    !text.toLowerCase().includes("opinas") &&
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

export function extractYouTubeId(url?: string | null): string | null {
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

export default function ClipCard({
  clip,
  index,
  isActive,
  onJump,
  videoId,
  videoUrl,
  videoTitle,
  videoChannel,
  isNewlyAdded = false,
}: Props) {
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

  // Hook title management & regeneration
  const [currentTitle, setCurrentTitle] = useState(clip.title);
  const [isEditingHook, setIsEditingHook] = useState(false);
  const [isGeneratingHooks, setIsGeneratingHooks] = useState(false);
  const [hookList, setHookList] = useState<string[]>(clip.alternative_hooks || []);
  const [hookSuccessMsg, setHookSuccessMsg] = useState<string | null>(null);
  const [customTitleInput, setCustomTitleInput] = useState(clip.title);
  const [isSavingCustomHook, setIsSavingCustomHook] = useState(false);

  // Modal personalización
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [customizerMode, setCustomizerMode] = useState<"smart_vertical" | "vertical_blur" | "original" | "split_screen">("smart_vertical");

  // Feedback
  const [copiedCopy, setCopiedCopy] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);

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

  // Keep internal state synchronized if clip props update
  useEffect(() => {
    setStartSec(clip.start_seconds);
    setEndSec(clip.end_seconds);
    setStatus(clip.status || "prospecto");
    setCurrentTitle(clip.title);
    setCustomTitleInput(clip.title);
    if (clip.alternative_hooks && Array.isArray(clip.alternative_hooks)) {
      setHookList(clip.alternative_hooks);
    }
    if (primaryThumb) {
      setThumbSrc(primaryThumb);
    }
  }, [clip.start_seconds, clip.end_seconds, clip.status, clip.title, clip.alternative_hooks, primaryThumb]);

  // Sync inputs when startSec/endSec change
  useEffect(() => {
    setStartTimeInput(formatTime(startSec));
    setEndTimeInput(formatTime(endSec));
  }, [startSec, endSec]);

  // Handle hook selection & update
  const handleSelectHook = async (newHook: string) => {
    const trimmed = newHook.trim();
    if (!trimmed) return;
    setCurrentTitle(trimmed);
    setCustomTitleInput(trimmed);
    setHookSuccessMsg("¡Gancho seleccionado y aplicado!");
    setTimeout(() => setHookSuccessMsg(null), 3000);

    if (clip.id) {
      try {
        await fetch(`/api/clips/${clip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
      } catch (e) {
        console.error("Error updating clip title:", e);
      }
    }
  };

  const handleSaveCustomHook = async () => {
    const trimmed = customTitleInput.trim();
    if (!trimmed || trimmed === currentTitle) return;
    setIsSavingCustomHook(true);
    await handleSelectHook(trimmed);
    setIsSavingCustomHook(false);
  };

  const handleRegenerateHooks = async () => {
    if (isGeneratingHooks) return;
    setIsGeneratingHooks(true);
    setHookSuccessMsg(null);
    try {
      const endpoint = clip.id ? `/api/clips/${clip.id}/generate-hooks` : `/api/clips/generate-hooks`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 4 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Error al generar ganchos con IA");
        setIsGeneratingHooks(false);
        return;
      }
      const data = await res.json();
      if (data.hooks && Array.isArray(data.hooks) && data.hooks.length > 0) {
        setHookList(data.hooks);
        setHookSuccessMsg("¡Nuevos ganchos generados con IA! Haz clic en cualquiera para aplicarlo.");
        setTimeout(() => setHookSuccessMsg(null), 4000);
      }
    } catch (e) {
      console.error("Error regenerating hooks:", e);
      alert("Error de conexión al generar nuevos ganchos");
    } finally {
      setIsGeneratingHooks(false);
    }
  };

  // Extract clean hook quote without robotic reflection
  let quoteText = clip.quote || "";

  if (!quoteText && clip.caption) {
    const cleanCap = clip.caption
      .replace(/(?:^|\n)\s*(?:💡\s*)?[Rr]eflexi[oó]n:[\s\S]*?(?=\n\n|\n📌|\n🎙|\n¿|$)/g, "")
      .replace(/#[a-zA-Z0-9_-]+/g, "")
      .trim();
    const paragraphs = cleanCap.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const nonAttribution = paragraphs.filter((p) => !p.startsWith("📌") && !p.startsWith("🎙") && !p.startsWith("💬"));
    if (nonAttribution.length > 0) {
      quoteText = nonAttribution[0];
    }
  } else if (!quoteText && (currentTitle || clip.title)) {
    quoteText = `“${currentTitle || clip.title}”`;
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

  const handleEnrich = async () => {
    if (!clip.id || isEnriching) return;
    setIsEnriching(true);
    try {
      const res = await fetch(`/api/clips/${clip.id}/enrich`, { method: "POST" });
      const data = await res.json();
      if (data.render_id) {
        const pollTimer = setInterval(async () => {
          try {
            const sRes = await fetch(`/api/clips/render-status/${data.render_id}`);
            const sData = await sRes.json();
            if (sData.status === "done") {
              clearInterval(pollTimer);
              setIsEnriching(false);
              router.refresh();
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            } else if (sData.status === "error") {
              clearInterval(pollTimer);
              setIsEnriching(false);
              alert("Error en Stage 2: " + (sData.error || "Desconocido"));
            }
          } catch {
            clearInterval(pollTimer);
            setIsEnriching(false);
          }
        }, 1500);
      } else {
        setIsEnriching(false);
      }
    } catch {
      setIsEnriching(false);
    }
  };

  const getFullPostCopy = () => {
    return buildPostDescription({
      caption: clip.caption,
      reason: clip.reason,
      title: currentTitle || clip.title,
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
        className={`${styles.card} ${isActive ? styles.cardActive : ""} ${isNewlyAdded ? styles.cardNewlyAdded : ""}`}
        id={clip.id ? `clip-${clip.id}` : `clip-card-${index}`}
      >
        {isActive && (
          <div className={styles.activeBanner}>
            <div className={styles.activeBadgeLeft}>
              <span className={styles.activePulseDot} />
              <span className={styles.activeBadgeText}>REPRODUCIENDO AHORA</span>
              <span className={styles.activeBadgeTime}>⏱ {formatTime(startSec)} – {formatTime(endSec)}</span>
            </div>
            <span className={styles.activeSelectedTag}>🎯 Seleccionado</span>
          </div>
        )}
        <div className={styles.mainRow}>
          {/* Circular Index Badge */}
          <div className={styles.indexBadge}>{index + 1}</div>

          {/* Video Thumbnail with exact moment frame & timestamp pill */}
          <div
            className={styles.thumbWrapper}
            onClick={() => {
              onJump(startSec);
              if (typeof window !== "undefined" && window.innerWidth <= 1024) {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
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
            {/* Top Row: Title + Score Pill + Stage2 badge */}
            <div className={styles.headerRow}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                <h3 className={styles.title}>{currentTitle}</h3>
                <button
                  type="button"
                  onClick={() => setIsEditingHook(!isEditingHook)}
                  className={`${styles.hookToggleBtn} ${isEditingHook ? styles.hookToggleBtnActive : ""}`}
                  title="Cambiar o regenerar títulos gancho con IA"
                >
                  <Sparkles size={11} />
                  <span>{isEditingHook ? "Cerrar" : "Ganchos"}</span>
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                {clip.stage2_done && (
                  <div
                    title={clip.hidden_angle ? `Ángulo IA: ${clip.hidden_angle}` : "Contenido social generado por Stage 2"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#a78bfa",
                      background: "rgba(167,139,250,0.12)",
                      border: "1px solid rgba(167,139,250,0.3)",
                      borderRadius: "999px",
                      padding: "2px 8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span>✨</span>
                    <span>Enfoque IA</span>
                  </div>
                )}
                {isNewlyAdded && (
                  <div
                    title="Clip generado recientemente"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#38bdf8",
                      background: "rgba(56, 189, 248, 0.15)",
                      border: "1px solid rgba(56, 189, 248, 0.4)",
                      borderRadius: "999px",
                      padding: "2px 8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span>✨</span>
                    <span>Nuevo</span>
                  </div>
                )}
                <div
                  className={`${styles.scorePill} ${clip.score >= 9 ? styles.scorePillGold : ""}`}
                  title={`Score de viralidad estimado: ${clip.score}/10`}
                >
                  <span>🔥</span>
                  <span>{clip.score}/10</span>
                </div>
              </div>
            </div>

            {/* Inline Hook Manager & Generator Panel */}
            {isEditingHook && (
              <div className={styles.hookManagerPanel}>
                <div className={styles.hookPanelHeader}>
                  <div className={styles.hookPanelTitleBlock}>
                    <Sparkles size={13} color="#38bdf8" />
                    <span className={styles.hookPanelTitle}>Títulos Gancho (Hooks Virales)</span>
                  </div>
                  <div className={styles.hookPanelActions}>
                    <button
                      type="button"
                      onClick={handleRegenerateHooks}
                      disabled={isGeneratingHooks}
                      className={styles.generateHooksBtn}
                    >
                      {isGeneratingHooks ? (
                        <>
                          <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>🔄</span>
                          <span>Generando con IA...</span>
                        </>
                      ) : (
                        <>
                          <span>✨</span>
                          <span>Regenerar ganchos IA</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingHook(false)}
                      className={styles.closeHookBtn}
                      title="Cerrar panel de ganchos"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {hookSuccessMsg && (
                  <div className={styles.hookSuccessAlert}>
                    <Check size={12} />
                    <span>{hookSuccessMsg}</span>
                  </div>
                )}

                <div className={styles.currentHookRow}>
                  <span className={styles.currentHookLabel}>Gancho activo en el clip:</span>
                  <span className={styles.currentHookValue}>{currentTitle}</span>
                </div>

                {hookList.length > 0 && (
                  <div className={styles.hooksListBlock}>
                    <span className={styles.hooksListSub}>Opciones sugeridas (haz clic para aplicar al clip):</span>
                    <div className={styles.hooksGrid}>
                      {hookList.map((h, hIdx) => {
                        const isCur = currentTitle.trim() === h.trim();
                        return (
                          <button
                            key={hIdx}
                            type="button"
                            onClick={() => handleSelectHook(h)}
                            className={`${styles.hookOptionItem} ${isCur ? styles.hookOptionSelected : ""}`}
                            title="Seleccionar este título gancho"
                          >
                            <div className={styles.hookOptionRadio}>
                              {isCur ? <Check size={12} color="#38bdf8" /> : <span className={styles.hookRadioDot} />}
                            </div>
                            <span className={styles.hookOptionText}>{h}</span>
                            {isCur && <span className={styles.activePill}>Activo</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className={styles.customHookRow}>
                  <input
                    type="text"
                    value={customTitleInput}
                    onChange={(e) => setCustomTitleInput(e.target.value)}
                    placeholder="Escribe o edita un título gancho personalizado..."
                    className={styles.customHookInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveCustomHook();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomHook}
                    disabled={isSavingCustomHook || !customTitleInput.trim() || customTitleInput.trim() === currentTitle}
                    className={styles.saveCustomHookBtn}
                  >
                    {isSavingCustomHook ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            )}

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

            {/* Engagement Question (Stage 2) */}
            {clip.engagement_question && (
              <p className={styles.reasonText} style={{ marginTop: "4px" }}>
                <span
                  className={styles.reflectionTag}
                  style={{
                    background: "rgba(56, 189, 248, 0.12)",
                    color: "#38bdf8",
                    borderColor: "rgba(56, 189, 248, 0.25)",
                  }}
                >
                  💬 Pregunta
                </span>
                {clip.engagement_question}
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
                onClick={() => {
                  onJump(startSec);
                  if (typeof window !== "undefined" && window.innerWidth <= 1024) {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
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
                        setIsEditingHook(true);
                        setShowMoreMenu(false);
                      }}
                    >
                      <Sparkles size={12} color="#38bdf8" />
                      <span>Cambiar / Regenerar gancho</span>
                    </button>
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
                      <span>Copiar post para redes</span>
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
                    {clip.id && (
                      <button
                        type="button"
                        className={styles.dropdownItem}
                        onClick={() => {
                          setShowMoreMenu(false);
                          handleEnrich();
                        }}
                        disabled={isEnriching}
                      >
                        <Sparkles size={12} color="#a78bfa" />
                        <span>
                          {isEnriching
                            ? "Generando Stage 2..."
                            : clip.stage2_done
                            ? "Regenerar enfoque IA"
                            : "Generar enfoque IA (Stage 2)"}
                        </span>
                      </button>
                    )}
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
              <div style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleCopyText}
                  style={{ fontSize: 11, padding: "6px 12px", whiteSpace: "nowrap" }}
                >
                  {copiedCopy ? <><Check size={11} color="#4ade80" /> Copiado</> : <><Copy size={11} /> Copiar texto</>}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCopyBox(false)}
                  title="Cerrar descripción"
                  aria-label="Cerrar descripción"
                  style={{
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "6px",
                    color: "#94a3b8",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    padding: 0,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#f87171";
                    e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                    e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#94a3b8";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                    e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
                  }}
                >
                  <X size={14} />
                </button>
              </div>
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
