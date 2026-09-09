"use client";

/**
 * /analyze/db/[videoId] — Vista de clips mejorada en base al Mockup High-End
 */

import { use, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ExternalLink,
  Share2,
  Plus,
  BarChart2,
  Home,
  History as HistoryIcon,
  Settings,
  Bell,
  ChevronDown,
  Pencil,
  Check,
  Flame,
} from "lucide-react";
import YouTubePlayer, { YouTubePlayerRef } from "@/components/YoutubePlayer";
import ClipCard, { Clip } from "@/components/ClipCard";
import SmartTimeline from "@/components/SmartTimeline";
import styles from "../../[jobId]/page.module.css";

interface VideoRecord {
  id: number;
  title: string;
  channel?: string | null;
  source_url: string | null;
  duration_seconds: number;
  cliente: string | null;
  created_at: string;
  clips_count: number;
  provider?: string | null;
  llm_model?: string | null;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url?.match(p);
    if (m) return m[1];
  }
  return null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} h ${m % 60} min`;
  return `${m} min ${s} s`;
}

export default function DbAnalyzePage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = use(params);

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeClipIdx, setActiveClipIdx] = useState<number | null>(null);
  const [playerTime, setPlayerTime] = useState(0);
  const [sortBy, setSortBy] = useState<"score" | "time" | "duration">("score");
  const [copiedShare, setCopiedShare] = useState(false);

  const playerRef = useRef<YouTubePlayerRef>(null);

  // ── Cargar video y clips desde la DB ───────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const vRes = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
      if (!vRes.ok) {
        setError(vRes.status === 404 ? "Video no encontrado en el historial." : "Error cargando el video.");
        setLoading(false);
        return;
      }
      const vData: VideoRecord = await vRes.json();
      setVideo(vData);

      const cRes = await fetch(`/api/videos/${videoId}/clips`, { cache: "no-store" });
      if (!cRes.ok) {
        setError("Error cargando los clips del video.");
        setLoading(false);
        return;
      }
      const cData: Clip[] = await cRes.json();
      setClips(cData);
      setLoading(false);
    } catch {
      setError("Error de red al cargar el historial.");
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Poll player current time for live timeline tracker ────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        if (playerRef.current && typeof playerRef.current.getCurrentTime === "function") {
          const t = playerRef.current.getCurrentTime();
          if (typeof t === "number" && !isNaN(t)) {
            setPlayerTime(t);
          }
        }
      } catch {}
    }, 600);
    return () => clearInterval(timer);
  }, []);

  // ── Jump to clip ────────────────────────────────────────────────────────────
  function handleJump(startSeconds: number, idx?: number) {
    try {
      playerRef.current?.seekTo(startSeconds);
    } catch {}
    setPlayerTime(startSeconds);
    if (idx !== undefined) {
      setActiveClipIdx(idx);
      document.getElementById(`clip-card-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ── Sort Clips ─────────────────────────────────────────────────────────────
  const sortedClips = useMemo(() => {
    const list = [...clips];
    if (sortBy === "score") {
      list.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === "time") {
      list.sort((a, b) => a.start_seconds - b.start_seconds);
    } else if (sortBy === "duration") {
      list.sort((a, b) => (b.end_seconds - b.start_seconds) - (a.end_seconds - a.start_seconds));
    }
    return list;
  }, [clips, sortBy]);

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  };

  const youtubeVideoId = video?.source_url ? extractYouTubeId(video.source_url) : null;

  // Formatted date
  const formattedDate = useMemo(() => {
    if (!video?.created_at) return "Analizado recientemente";
    try {
      const d = new Date(video.created_at);
      return `Analizado ${d.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "short",
      })}, ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      return "Analizado recientemente";
    }
  }, [video?.created_at]);

  const handleUpdateClipTimes = (clipId: number, startSec: number, endSec: number) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, start_seconds: startSec, end_seconds: endSec } : c
      )
    );
  };

  return (
    <div className={styles.appShell}>
      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <div className={styles.mainWrapper}>
        {/* Top Navbar */}
        <header className={styles.mockupTopBar}>
          {/* Left: Logo & Nav Links */}
          <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
            <Link href="/" className={styles.logoLink}>
              <Image
                src="/logo-clypfast.png"
                alt="ClypFast"
                width={135}
                height={30}
                style={{ height: "26px", width: "auto", objectFit: "contain" }}
                priority
              />
            </Link>

            {/* Navigation Pills */}
            <nav className={styles.navPillContainer}>
              <Link href="/" className={styles.navPill}>
                Inicio
              </Link>
              <Link href={`/analyze/db/${videoId}`} className={`${styles.navPill} ${styles.navPillActive}`}>
                Análisis
              </Link>
              <Link href="/history" className={styles.navPill}>
                Historial
              </Link>
              <Link href="/#configuracion" className={styles.navPill}>
                Configuración
              </Link>
            </nav>
          </div>

          {/* Right: Plan Pro badge, Notifications & Profile */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                padding: "5px 12px",
                borderRadius: "99px",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "#ffffff", fontWeight: 600 }}>Plan Pro</span>
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>245 créditos</span>
            </div>

            <button
              type="button"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.7)",
                cursor: "pointer",
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
              title="Notificaciones"
            >
              <Bell size={18} />
              <span
                style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: "#ef4444",
                }}
              />
            </button>

            <div className={styles.userPill}>
              <div className={styles.userAvatar}>M</div>
              <span className={styles.userName}>Marcos</span>
              <ChevronDown size={14} className={styles.userChevron} />
            </div>
          </div>
        </header>

        {/* Loading State */}
        {loading && (
          <div className={styles.initialLoading} style={{ padding: "80px 0" }}>
            <span className="spinner spinner-lg" />
            <p style={{ marginTop: "16px", color: "rgba(255,255,255,0.7)" }}>Cargando análisis de clips...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className={`${styles.errorCard} glass-card fade-in`}>
            <div className={styles.errorIconCircle}>
              <span style={{ fontSize: "24px" }}>⚠️</span>
            </div>
            <h2 className={styles.errorTitle}>No se pudo cargar</h2>
            <p className={styles.errorMsg}>{error}</p>
            <Link href="/" className={styles.actionPrimaryBtn} style={{ marginTop: 8 }}>
              ← Volver al inicio
            </Link>
          </div>
        )}

        {/* Loaded Content */}
        {!loading && !error && video && (
          <>
            {/* ── Video Header Bar ────────────────────────────────────────── */}
            <div className={styles.videoHeaderBar}>
              <div className={styles.videoTitleBlock}>
                <Link href="/history" className={styles.backBtn} title="Volver al historial">
                  <ArrowLeft size={16} />
                </Link>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h1 className={styles.videoTitle}>{video.title || `Video #${video.id}`}</h1>
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(255,255,255,0.4)",
                        cursor: "pointer",
                        padding: 0,
                      }}
                      title="Editar título"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  {/* Metadata line */}
                  <div className={styles.videoMetaRow}>
                    {video.channel && (
                      <span style={{ color: "#ffffff", fontWeight: 600 }}>
                        {video.channel}
                      </span>
                    )}
                    <span>•</span>
                    <span>YouTube</span>
                    {video.duration_seconds > 0 && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(video.duration_seconds)}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>{formattedDate}</span>

                    {/* Model Provider Pill */}
                    {video.provider && (
                      <>
                        <span>•</span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: "4px",
                            background:
                              (video.provider || "").toLowerCase() === "groq"
                                ? "rgba(249, 115, 22, 0.18)"
                                : "rgba(168, 85, 247, 0.18)",
                            color:
                              (video.provider || "").toLowerCase() === "groq"
                                ? "#fb923c"
                                : "#c084fc",
                            border: `1px solid ${
                              (video.provider || "").toLowerCase() === "groq"
                                ? "rgba(249, 115, 22, 0.3)"
                                : "rgba(168, 85, 247, 0.3)"
                            }`,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                          }}
                        >
                          {(video.provider || "").toLowerCase() === "groq" ? "⚡ Groq" : "✨ Gemini"}
                        </span>
                      </>
                    )}

                    {video.cliente && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: "4px",
                          background: "rgba(167, 139, 250, 0.18)",
                          color: "#a78bfa",
                        }}
                      >
                        🏷️ {video.cliente}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Action Buttons */}
              <div className={styles.headerActions}>
                {video.source_url && (
                  <a
                    href={video.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.actionSecondaryBtn}
                    title="Ver video original en YouTube"
                  >
                    <ExternalLink size={14} />
                    <span>Ver original</span>
                  </a>
                )}

                <button
                  type="button"
                  className={styles.actionSecondaryBtn}
                  onClick={handleShare}
                  title="Compartir enlace de este análisis"
                >
                  {copiedShare ? <Check size={14} color="#34d399" /> : <Share2 size={14} />}
                  <span>{copiedShare ? "¡Copiado!" : "Compartir"}</span>
                </button>

                <Link href="/" className={styles.actionPrimaryBtn} title="Crear un nuevo análisis">
                  <Plus size={15} />
                  <span>Nuevo análisis</span>
                </Link>
              </div>
            </div>

            {/* ── 2-Column Dashboard Grid ─────────────────────────────────── */}
            <div className={styles.dashboardGrid}>
              {/* Left Column: Player + Smart Timeline */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                {/* Video Player */}
                <div className={styles.playerWrapper}>
                  {youtubeVideoId ? (
                    <YouTubePlayer
                      ref={playerRef}
                      videoId={youtubeVideoId}
                      className={styles.player}
                    />
                  ) : (
                    <div className={styles.noEmbed}>
                      <span>🎬</span>
                      <p>Video no disponible para reproducción incrustada.</p>
                      {video.source_url && (
                        <a href={video.source_url} target="_blank" rel="noopener noreferrer">
                          Ver fuente original en YouTube →
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Línea de tiempo inteligente */}
                <SmartTimeline
                  duration={video.duration_seconds || 300}
                  currentTime={playerTime}
                  clips={clips}
                  activeClipIndex={activeClipIdx}
                  onJump={handleJump}
                  videoId={youtubeVideoId}
                  dbVideoId={video.id}
                  onUpdateClipTimes={handleUpdateClipTimes}
                />
              </div>

              {/* Right Column: Viral Moments List */}
              <div>
                {/* Clips Mockup Header */}
                <div className={styles.clipsMockupHeader}>
                  <div>
                    <div className={styles.clipsMockupTitleBlock}>
                      <span style={{ color: "#38bdf8", display: "flex" }}>
                        <BarChart2 size={20} />
                      </span>
                      <h2 className={styles.clipsMockupTitle}>
                        {clips.length} Momentos Virales
                      </h2>
                    </div>
                    <p className={styles.clipsMockupSubtitle}>
                      Haz clic en un clip para saltar al momento en el video.
                    </p>
                  </div>

                  {/* Sort Dropdown */}
                  <div className={styles.sortSelectWrapper}>
                    <span>Ordenar por:</span>
                    <select
                      className={styles.sortSelect}
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as "score" | "time" | "duration")}
                    >
                      <option value="score">Score</option>
                      <option value="time">Inicio en video</option>
                      <option value="duration">Duración</option>
                    </select>
                  </div>
                </div>

                {/* Clips List */}
                {sortedClips.length === 0 ? (
                  <div className={`${styles.emptyClips} glass-card`}>
                    <span style={{ fontSize: "32px" }}>📂</span>
                    <p>No se encontraron clips guardados para este video.</p>
                  </div>
                ) : (
                  <div className={styles.clipsList}>
                    {sortedClips.map((clip, i) => (
                      <ClipCard
                        key={clip.id ?? i}
                        clip={clip}
                        index={i}
                        isActive={activeClipIdx === i}
                        onJump={(s) => handleJump(s, i)}
                        videoId={youtubeVideoId ?? undefined}
                        videoUrl={video.source_url ?? undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
