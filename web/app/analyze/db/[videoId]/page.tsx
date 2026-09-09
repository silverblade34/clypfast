"use client";

/**
 * /analyze/db/[videoId] — Vista de clips desde la base de datos SQLite
 *
 * Esta página carga directamente el video y sus clips del historial persistente,
 * sin depender del job en memoria (que se pierde al reiniciar el servidor).
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import YouTubePlayer, { YouTubePlayerRef } from "@/components/YoutubePlayer";
import ClipCard, { Clip } from "@/components/ClipCard";
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
  if (h > 0) return `${h}h ${m % 60}m ${s}s`;
  return `${m}m ${s}s`;
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

  const playerRef = useRef<YouTubePlayerRef>(null);

  // ── Cargar video y clips desde la DB ───────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      // Cargar metadatos del video
      const vRes = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
      if (!vRes.ok) {
        setError(vRes.status === 404 ? "Video no encontrado en el historial." : "Error cargando el video.");
        setLoading(false);
        return;
      }
      const vData: VideoRecord = await vRes.json();
      setVideo(vData);

      // Cargar clips
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

  // ── Jump to clip ────────────────────────────────────────────────────────────
  function handleJump(startSeconds: number, idx: number) {
    try { playerRef.current?.seekTo(startSeconds); } catch { /* ignore */ }
    setActiveClipIdx(idx);
    document.getElementById(`clip-card-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const youtubeVideoId = video?.source_url ? extractYouTubeId(video.source_url) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-wrapper">
      <div className="bg-orbs">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
      </div>

      {/* Header */}
      <header className={styles.header}>
        <div className="container">
          <div className={styles.headerInner}>
            <Link href="/" className="logo">
              <Image
                src="/logo-clypfast.png"
                alt="ClypFast"
                width={130}
                height={30}
                style={{ height: "26px", width: "auto", objectFit: "contain" }}
              />
            </Link>

            {!loading && !error && video && (
              <div className={styles.headerMeta}>
                <span className={styles.metaBadge}>
                  🗂 Del historial
                </span>
                <span className={styles.metaBadge}>
                  🎯 {clips.length} clips
                </span>
                {video.duration_seconds > 0 && (
                  <span className={styles.metaBadge}>
                    ⏱ {formatDuration(video.duration_seconds)}
                  </span>
                )}
                {video.cliente && (
                  <span className={styles.metaBadge}>
                    👤 {video.cliente}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Link
                href="/history"
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontWeight: 600,
                }}
              >
                📂 Historial
              </Link>
              <Link href="/" className={styles.newAnalysisBtn} id="new-analysis-btn">
                + Nuevo análisis
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className="container">

          {/* Estado de carga */}
          {loading && (
            <div className={styles.initialLoading}>
              <span className="spinner spinner-lg" />
              <p>Cargando historial...</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className={`${styles.errorCard} glass-card fade-in`}>
              <span className={styles.errorIcon}>⚠️</span>
              <h2 className={styles.errorTitle}>No se pudo cargar</h2>
              <p className={styles.errorMsg}>{error}</p>
              <Link href="/" className="btn-primary" style={{ marginTop: 8 }}>
                ← Volver al inicio
              </Link>
            </div>
          )}

          {/* Resultado */}
          {!loading && !error && video && (
            <>
              {/* Video Title & Channel Header */}
              <div
                className="glass-card fade-in"
                style={{
                  padding: "16px 22px",
                  marginBottom: 20,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {video.channel && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 9px",
                          background: "rgba(34, 211, 238, 0.15)",
                          color: "var(--cyan)",
                          borderRadius: 6,
                          border: "1px solid rgba(34, 211, 238, 0.25)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        📺 {video.channel}
                      </span>
                    )}
                    {video.cliente && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 8px",
                          background: "rgba(167, 139, 250, 0.2)",
                          color: "#a78bfa",
                          borderRadius: 6,
                        }}
                      >
                        🏷️ {video.cliente}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      📅 {new Date(video.created_at).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1.3 }}>
                    {video.title || `Video #${video.id}`}
                  </h1>
                </div>

                {video.source_url && (
                  <a
                    href={video.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--cyan)",
                      textDecoration: "none",
                      fontSize: 13,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 600,
                    }}
                  >
                    ↗ Ver en YouTube
                  </a>
                )}
              </div>

              <div className={`${styles.resultsLayout} fade-in`}>

              {/* Izquierda: Player */}
              <div className={styles.playerSection}>
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
                      <p>Video no disponible para reproducción directa.</p>
                      {video.source_url && (
                        <a href={video.source_url} target="_blank" rel="noopener noreferrer">
                          Ver fuente →
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className={styles.statsRow}>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>{clips.length}</span>
                    <span className={styles.statLabel}>clips</span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>
                      {video.duration_seconds > 0 ? formatDuration(video.duration_seconds) : "—"}
                    </span>
                    <span className={styles.statLabel}>duración</span>
                  </div>
                  {clips.length > 0 && (
                    <div className={styles.statCard}>
                      <span className={styles.statValue}>{clips[0].score}/10</span>
                      <span className={styles.statLabel}>top score</span>
                    </div>
                  )}
                  <div className={styles.statCard}>
                    <span className={styles.statValue} style={{ fontSize: 11 }}>
                      {new Date(video.created_at).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className={styles.statLabel}>analizado</span>
                  </div>
                </div>
              </div>

              {/* Derecha: Lista de clips */}
              <div className={styles.clipsSection}>
                <div className={styles.clipsHeader}>
                  <h2 className={styles.clipsTitle}>
                    🎯{" "}
                    <span className="gradient-text">
                      {clips.length} Momentos Virales
                    </span>
                  </h2>
                  <p className={styles.clipsSubtitle}>
                    Haz clic en un clip para saltar al momento en el video
                  </p>
                </div>

                {clips.length === 0 ? (
                  <div className={`${styles.noClips} glass-card`}>
                    <span>😔</span>
                    <p>Este video no tiene clips guardados.</p>
                  </div>
                ) : (
                  <div className={styles.clipsList}>
                    {clips.map((clip, i) => (
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
      </main>
    </div>
  );
}
