"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import YouTubePlayer, { YouTubePlayerRef } from "@/components/YoutubePlayer";
import ClipCard, { Clip } from "@/components/ClipCard";
import ProgressSteps from "@/components/ProgressSteps";
import styles from "./page.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface JobData {
  status: "running" | "done" | "error";
  step: string;
  step_label: string;
  progress: number;
  video_id: string | null;
  duration: number;
  segments: number;
  chunk_current: number;
  chunk_total: number;
  download_pct?: number;
  download_speed?: string;
  transcribe_pct?: number;
  transcribe_segs?: number;
  transcription_method_used?: "youtube_subs" | "groq" | "local" | null;
  url: string;
  result: {
    video_source: string;
    duration_seconds: number;
    clips: Clip[];
    transcript_segments: number;
    llm_model: string;
    whisper_model: string;
  } | null;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s}s`;
  return `${m}m ${s}s`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyzePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);

  const [job, setJob] = useState<JobData | null>(null);
  const [error, setError] = useState("");
  const [activeClipIdx, setActiveClipIdx] = useState<number | null>(null);

  const playerRef = useRef<YouTubePlayerRef>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipsListRef = useRef<HTMLDivElement>(null);

  // ── Polling ────────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 503) {
          setError(
            "No se puede conectar al servidor de análisis. ¿Está corriendo FastAPI en :8000?"
          );
          stopPolling();
          return;
        }
        setError("Job no encontrado.");
        stopPolling();
        return;
      }
      const data: JobData = await res.json();
      setJob(data);

      if (data.status === "done" || data.status === "error") {
        stopPolling();
      }
    } catch {
      setError("Error de red al consultar el estado del análisis.");
      stopPolling();
    }
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    poll(); // immediate first call
    intervalRef.current = setInterval(poll, 2000);
    return () => stopPolling();
  }, [poll]);

  // ── Jump to clip ────────────────────────────────────────────────────────────
  function handleJump(startSeconds: number, idx: number) {
    try {
      playerRef.current?.seekTo(startSeconds);
    } catch (err) {
      console.warn("Error seeking player:", err);
    }
    setActiveClipIdx(idx);

    // Scroll the clicked card into view on mobile
    const card = document.getElementById(`clip-card-${idx}`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const clips = job?.result?.clips ?? [];
  const videoUrl = job?.url ?? "";
  const videoId = job?.video_id || extractYouTubeId(videoUrl);
  const isDone = job?.status === "done";
  const isError = job?.status === "error" || !!error;

  return (
    <div className="page-wrapper">
      {/* Background orbs */}
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

            {isDone && (
              <div className={styles.headerMeta}>
                <span className={styles.metaBadge}>
                  🎯 {clips.length} clips
                </span>
                {job?.result?.duration_seconds != null && (
                  <span className={styles.metaBadge}>
                    ⏱ {formatDuration(job.result.duration_seconds)}
                  </span>
                )}
                {job?.transcription_method_used && (
                  <span className={styles.metaBadge}>
                    {job.transcription_method_used === "youtube_subs"
                      ? "⚡ Subs YouTube (1s)"
                      : job.transcription_method_used === "groq"
                      ? "🚀 Groq Large-v3"
                      : "💻 Whisper M3 Pro"}
                  </span>
                )}
                <span className={styles.metaBadge}>
                  🧠 {job?.result?.llm_model?.split("/").pop()}
                </span>
              </div>
            )}

            <Link href="/" className={styles.newAnalysisBtn} id="new-analysis-btn">
              + Nuevo análisis
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        <div className="container">
          {/* Loading / Progress state */}
          {!isDone && !isError && job && (
            <div className={styles.progressLayout}>
              <div className={`${styles.progressCard} glass-card fade-in`}>
                <div className={styles.progressHeader}>
                  <h1 className={styles.progressTitle}>Analizando video...</h1>
                  {videoId && (
                    <p className={styles.progressUrl}>
                      <span>🔗</span>
                      <a
                        href={videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.urlLink}
                      >
                        {videoUrl.length > 60
                          ? videoUrl.slice(0, 60) + "..."
                          : videoUrl}
                      </a>
                    </p>
                  )}
                </div>

                <ProgressSteps
                  currentStep={job.step}
                  stepLabel={job.step_label}
                  progress={job.progress}
                  segments={job.segments}
                  duration={job.duration}
                  chunkCurrent={job.chunk_current}
                  chunkTotal={job.chunk_total}
                  downloadPct={job.download_pct}
                  downloadSpeed={job.download_speed}
                  transcribePct={job.transcribe_pct}
                  transcribeSegs={job.transcribe_segs}
                  transcriptionMethodUsed={job.transcription_method_used}
                />

                <p className={styles.progressNote}>
                  Este proceso puede tardar varios minutos dependiendo de la
                  duración del video y el modelo Whisper seleccionado.
                </p>
              </div>

              {/* Thumbnail preview while loading */}
              {videoId && (
                <div className={`${styles.previewCard} glass-card fade-in`}>
                  <img
                    src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                    alt="Video thumbnail"
                    className={styles.thumbnail}
                  />
                  <div className={styles.thumbnailOverlay}>
                    <span className="spinner spinner-lg" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className={`${styles.errorCard} glass-card fade-in`}>
              <span className={styles.errorIcon}>⚠️</span>
              <h2 className={styles.errorTitle}>Error en el análisis</h2>
              <p className={styles.errorMsg}>
                {error || job?.error || "Error desconocido"}
              </p>
              <Link href="/" className="btn-primary" style={{ marginTop: 8 }}>
                ← Volver al inicio
              </Link>
            </div>
          )}

          {/* Results state */}
          {isDone && (
            <div className={`${styles.resultsLayout} fade-in`}>
              {/* Left: Video player (sticky) */}
              <div className={styles.playerSection}>
                <div className={styles.playerWrapper}>
                  {videoId ? (
                    <YouTubePlayer
                      ref={playerRef}
                      videoId={videoId}
                      className={styles.player}
                    />
                  ) : (
                    <div className={styles.noEmbed}>
                      <span>🎬</span>
                      <p>Este video no puede embeberse directamente.</p>
                      <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                        Ver en YouTube →
                      </a>
                    </div>
                  )}
                </div>

                {/* Stats below player */}
                <div className={styles.statsRow}>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>{clips.length}</span>
                    <span className={styles.statLabel}>clips</span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>
                      {job?.result?.transcript_segments ?? 0}
                    </span>
                    <span className={styles.statLabel}>segmentos</span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statValue}>
                      {job?.result?.duration_seconds != null
                        ? formatDuration(job.result.duration_seconds)
                        : "—"}
                    </span>
                    <span className={styles.statLabel}>duración</span>
                  </div>
                  {clips.length > 0 && (
                    <div className={styles.statCard}>
                      <span className={styles.statValue}>
                        {clips[0].score}/10
                      </span>
                      <span className={styles.statLabel}>top score</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Clips list */}
              <div className={styles.clipsSection} ref={clipsListRef}>
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
                    <p>No se detectaron clips virales en este video.</p>
                    <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
                      Intenta con un modelo Whisper más grande o un video con más habla.
                    </p>
                  </div>
                ) : (
                  <div className={styles.clipsList}>
                    {clips.map((clip, i) => (
                      <ClipCard
                        key={i}
                        clip={clip}
                        index={i}
                        isActive={activeClipIdx === i}
                        onJump={(s) => handleJump(s, i)}
                        videoId={videoId ?? undefined}
                        videoUrl={videoUrl}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Initial loading state (before first poll) */}
          {!job && !error && (
            <div className={styles.initialLoading}>
              <span className="spinner spinner-lg" />
              <p>Conectando con el servidor...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
