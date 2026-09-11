"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Clock,
  Sparkles,
  FileText,
  Play,
  Film,
  Zap,
  ChevronDown,
  AlertCircle,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import YouTubePlayer, { YouTubePlayerRef } from "@/components/YoutubePlayer";
import ClipCard, { Clip } from "@/components/ClipCard";
import ProgressSteps from "@/components/ProgressSteps";
import SmartTimeline from "@/components/SmartTimeline";
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
  chunk_time_range?: string;
  clips_found_so_far?: number;
  live_clips?: Array<{
    title: string;
    score: number;
    start_seconds: number;
    end_seconds: number;
    reason?: string;
    stage2_done?: boolean;
    hook?: string;
    alternative_hooks?: string[];
    core_idea?: string;
    hidden_angle?: string;
    engagement_question?: string;
  }>;
  transcript_preview?: Array<{
    time: string;
    text: string;
  }>;
  download_pct?: number;
  download_speed?: string;
  transcribe_pct?: number;
  transcribe_segs?: number;
  transcription_method_used?: "youtube_subs" | "groq" | "local" | null;
  url: string;
  video_title?: string;
  video_channel?: string;
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
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

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
  }, [jobId]);

  function stopPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => stopPolling();
  }, [poll]);

  function handleJump(startSeconds: number, idx?: number) {
    try {
      playerRef.current?.seekTo(startSeconds);
    } catch (err) {
      console.warn("Error seeking player:", err);
    }
    if (idx !== undefined && idx >= 0) {
      setActiveClipIdx(idx);
    }

    if (typeof window !== "undefined" && window.innerWidth <= 1024) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const [playerTime, setPlayerTime] = useState(0);
  const [localClips, setLocalClips] = useState<Clip[]>([]);

  useEffect(() => {
    if (job?.result?.clips) {
      setLocalClips(job.result.clips);
    }
  }, [job?.result?.clips]);

  const clips = localClips.length > 0 ? localClips : (job?.result?.clips ?? []);
  const videoUrl = job?.url ?? "";
  const videoId = job?.video_id || extractYouTubeId(videoUrl);
  const isDone = job?.status === "done";
  const isError = job?.status === "error" || !!error;

  const orderedClipsWithIndex = useMemo(() => {
    return clips.map((clip, originalIndex) => ({ clip, originalIndex }));
  }, [clips]);

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

  const handleUpdateClipTimes = (clipId: number, startSec: number, endSec: number) => {
    setLocalClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, start_seconds: startSec, end_seconds: endSec } : c
      )
    );
  };

  // Calculate estimated time remaining
  const estimatedMin =
    job?.duration && job.duration > 0
      ? Math.max(1, Math.round((job.duration / 60) * 0.15))
      : 3;

  const dbVidId = (job?.result as any)?.video_db_id ?? (job?.video_id && !isNaN(Number(job.video_id)) ? Number(job.video_id) : null);

  return (
    <div className="page-wrapper">
      {/* Background ambient orbs */}
      <div className="bg-orbs">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
      </div>

      {/* Top Navbar */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logoLink}>
            <Image
              src="/logo-clypfast.png"
              alt="ClypFast"
              width={140}
              height={32}
              className={styles.logoImg}
              priority
            />
          </Link>

          {/* Navigation Pills */}
          <nav className={styles.navPillContainer}>
            <Link href="/" className={styles.navPill}>
              Inicio
            </Link>
            <Link
              href={`/analyze/${jobId}`}
              className={`${styles.navPill} ${styles.navPillActive}`}
            >
              Análisis
            </Link>
            <Link href="/history" className={styles.navPill}>
              Historial
            </Link>
            <Link href="/#configuracion" className={styles.navPill}>
              Configuración
            </Link>
          </nav>

          {/* User Profile Pill */}
          <div className={styles.userPill}>
            <div className={styles.userAvatar}>M</div>
            <span className={styles.userName}>Marcos</span>
            <ChevronDown size={14} className={styles.userChevron} />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className={styles.main}>
        {!isDone && (
          <div className="container">
          {/* ── LOADING / IN-PROGRESS VIEW ───────────────────────────────── */}
          {!isDone && !isError && job && (
            <div className={styles.progressLayout}>
              {/* Left Column: Progress Card with Stepper */}
              <div className={`${styles.progressCard} glass-card fade-in`}>
                <div className={styles.progressCardHeader}>
                  <div className={styles.headerTitles}>
                    <h1 className={styles.progressTitle}>Analizando video...</h1>
                    <p className={styles.progressSubtitle}>
                      Estamos procesando tu video y detectando los mejores momentos.
                    </p>
                  </div>
                  <div className={styles.timeEstBadge}>
                    <Clock size={15} className={styles.timeIcon} />
                    <span>Tiempo estimado</span>
                    <strong className={styles.timeVal}>~ {estimatedMin} min</strong>
                  </div>
                </div>

                {/* Gradient Progress Bar */}
                <div className={styles.progressBarSection}>
                  <div className={styles.progressBarTrack}>
                    <div
                      className={styles.progressBarFill}
                      style={{ width: `${Math.max(job.progress, 5)}%` }}
                    />
                  </div>
                  <span className={styles.progressBarPct}>{job.progress}%</span>
                </div>

                {/* 6-Step Connected Stepper */}
                <ProgressSteps
                  currentStep={job.step}
                  stepLabel={job.step_label}
                  progress={job.progress}
                  segments={job.segments}
                  duration={job.duration}
                  chunkCurrent={job.chunk_current}
                  chunkTotal={job.chunk_total}
                  chunkTimeRange={job.chunk_time_range}
                  clipsFoundSoFar={
                    job.clips_found_so_far ?? job.live_clips?.length ?? 0
                  }
                  downloadPct={job.download_pct}
                  downloadSpeed={job.download_speed}
                  transcribePct={job.transcribe_pct}
                  transcribeSegs={job.transcribe_segs}
                  transcriptionMethodUsed={job.transcription_method_used}
                  videoUrl={videoUrl}
                />

                {/* Bottom Tip Card */}
                <div className={styles.bottomTipCard}>
                  <div className={styles.tipIconCircle}>
                    <Sparkles size={16} />
                  </div>
                  <p className={styles.tipText}>
                    Este proceso puede tardar unos minutos dependiendo de la
                    duración del video. Puedes dejar esta página abierta. Te
                    avisaremos cuando esté listo.
                  </p>
                </div>
              </div>

              {/* Right Column: Video Preview + Live Activity Feed */}
              <div className={styles.rightColumn}>
                {/* Video Thumbnail Preview */}
                {videoId && (
                  <div className={`${styles.previewCard} glass-card fade-in`}>
                    <img
                      src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                      alt="Miniatura de video"
                      className={styles.thumbnail}
                    />
                    <div className={styles.thumbnailOverlay}>
                      <div className={styles.playCircle}>
                        <Play size={22} fill="white" className={styles.playIcon} />
                      </div>
                    </div>
                    {job.duration > 0 && (
                      <div className={styles.durationPill}>
                        {formatDuration(job.duration)}
                      </div>
                    )}
                  </div>
                )}

                {/* Live Activity Feed Card */}
                <div className={`${styles.liveFeedCard} glass-card fade-in`}>
                  <div className={styles.liveFeedHeader}>
                    <div className={styles.liveFeedHeaderIcon}>
                      {job.step === "analyze" ? (
                        <Sparkles size={18} className={styles.cyanIcon} />
                      ) : (
                        <FileText size={18} className={styles.blueIcon} />
                      )}
                    </div>
                    <div className={styles.liveFeedHeaderText}>
                      <h3 className={styles.liveFeedTitle}>
                        {job.step === "analyze"
                          ? "Análisis de momentos virales"
                          : "Transcripción en progreso"}
                      </h3>
                      <p className={styles.liveFeedSubtitle}>
                        {job.step === "analyze"
                          ? `Gemini 3.5 Flash Lite está evaluando ganchos y retención${
                              job.chunk_time_range
                                ? ` en sección ${job.chunk_time_range}`
                                : ""
                            }`
                          : "La IA está procesando el contenido del video en tiempo real."}
                      </p>
                    </div>
                  </div>

                  {/* Feed Container */}
                  <div className={styles.liveFeedContent}>
                    {(job.step === "analyze" ||
                      job.step === "analyze_done" ||
                      job.step === "saving" ||
                      job.step === "enrich") &&
                    job.live_clips &&
                    job.live_clips.length > 0 ? (
                      <div className={styles.liveClipsList}>
                        <div className={styles.liveClipsCountBadge}>
                          <Sparkles size={13} />
                          <span>
                            {job.step === "enrich"
                              ? `Stage 2: Generando contenido social (${job.live_clips.filter((c) => c.stage2_done).length}/${job.live_clips.length})`
                              : `${job.live_clips.length} momentos candidatos detectados`}
                          </span>
                        </div>
                        {job.live_clips.map((c, idx) => (
                          <div key={idx} className={styles.liveClipItem}>
                            <div className={styles.liveClipTop}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span className={styles.liveClipScore}>
                                  Score {c.score}/10
                                </span>
                                {c.stage2_done && (
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 700,
                                      color: "#a78bfa",
                                      background: "rgba(167,139,250,0.12)",
                                      border: "1px solid rgba(167,139,250,0.3)",
                                      borderRadius: "999px",
                                      padding: "1px 6px",
                                    }}
                                  >
                                    ✨ Enfoque IA
                                  </span>
                                )}
                              </div>
                              <span className={styles.liveClipTime}>
                                {formatDuration(c.start_seconds)} -{" "}
                                {formatDuration(c.end_seconds)}
                              </span>
                            </div>
                            <p className={styles.liveClipTitle}>{c.title}</p>
                            {c.hidden_angle && (
                              <p
                                style={{
                                  fontSize: "11px",
                                  color: "#94a3b8",
                                  marginTop: "3px",
                                  lineHeight: 1.3,
                                }}
                              >
                                🎯 {c.hidden_angle}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : job.transcript_preview &&
                      job.transcript_preview.length > 0 ? (
                      <div className={styles.transcriptLines}>
                        {job.transcript_preview.map((line, idx) => (
                          <div key={idx} className={styles.transcriptLine}>
                            <span className={styles.transcriptTime}>
                              {line.time}
                            </span>
                            <span className={styles.transcriptText}>
                              {line.text}
                            </span>
                          </div>
                        ))}
                        <div className={styles.transcriptDots}>...</div>
                      </div>
                    ) : (
                      <div className={styles.feedEmpty}>
                        <div className={styles.pulseIndicator} />
                        <span>
                          {job.step === "download"
                            ? "Descargando pista de audio 16kHz mono..."
                            : "Esperando fragmentos de audio para transcribir..."}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── ERROR STATE ────────────────────────────────────────────── */}
          {isError && (
            <div className={`${styles.errorCard} glass-card fade-in`}>
              <div className={styles.errorIconCircle}>
                <AlertCircle size={28} className={styles.errorAlertIcon} />
              </div>
              <h2 className={styles.errorTitle}>Error en el análisis</h2>
              <p className={styles.errorMsg}>
                {error || job?.error || "Error desconocido durante el procesamiento"}
              </p>
              <Link href="/" className="btn-primary" style={{ marginTop: 12 }}>
                <ArrowLeft size={16} style={{ marginRight: 6 }} />
                Volver al inicio
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── RESULTS VIEW (WHEN DONE) ────────────────────────────────── */}
        {isDone && (
          <div className={styles.mainWrapper}>
            <div className={`${styles.dashboardGrid} fade-in`}>
              {/* Left: Video player */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div className={styles.playerWrapper}>
                  {videoId ? (
                    <YouTubePlayer
                      ref={playerRef}
                      videoId={videoId}
                      className={styles.player}
                    />
                  ) : (
                    <div className={styles.noEmbed}>
                      <Film size={32} />
                      <p>Este video no puede embeberse directamente.</p>
                      <a
                        href={videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.externalLink}
                      >
                        Ver en YouTube <ExternalLink size={14} />
                      </a>
                    </div>
                  )}
                </div>

                {/* Línea de tiempo inteligente */}
                <SmartTimeline
                  duration={job?.result?.duration_seconds || job?.duration || 300}
                  currentTime={playerTime}
                  clips={clips}
                  activeClipIndex={activeClipIdx}
                  onJump={(s, i) => handleJump(s, i)}
                  videoId={videoId}
                  dbVideoId={dbVidId}
                  onUpdateClipTimes={handleUpdateClipTimes}
                />

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
                        {Math.max(...clips.map((c) => c.score))}/10
                      </span>
                      <span className={styles.statLabel}>score máx</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Clips list */}
              <div>
                <div className={styles.clipsMockupHeader}>
                  <div>
                    <div className={styles.clipsMockupTitleBlock}>
                      <h2 className={styles.clipsMockupTitle}>{clips.length} Momentos Virales</h2>
                    </div>
                    <p className={styles.clipsMockupSubtitle}>
                      Haz clic en un clip para saltar al momento en el video.
                    </p>
                  </div>
                  <Link href="/" className={styles.actionPrimaryBtn}>
                    + Nuevo análisis
                  </Link>
                </div>

                {clips.length === 0 ? (
                  <div className={`${styles.emptyClips} glass-card`}>
                    <Film size={24} />
                    <p>No se encontraron clips virales para este video.</p>
                  </div>
                ) : (
                  <div className={styles.clipsList}>
                    {orderedClipsWithIndex.map(({ clip, originalIndex }) => (
                      <ClipCard
                        key={clip.id ?? originalIndex}
                        clip={clip}
                        index={originalIndex}
                        isActive={activeClipIdx === originalIndex}
                        onJump={(s) => handleJump(s, originalIndex)}
                        videoId={videoId ?? undefined}
                        videoUrl={videoUrl}
                        videoTitle={job?.video_title}
                        videoChannel={job?.video_channel}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
