"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Sliders, FileText, Copy, Check, ChevronRight } from "lucide-react";
import { Clip } from "./ClipCard";

interface SmartTimelineProps {
  duration: number;
  currentTime?: number;
  clips: Clip[];
  activeClipIndex: number | null;
  onJump: (seconds: number, index?: number) => void;
  videoId?: string | null;
  dbVideoId?: number | null;
  onUpdateClipTimes?: (clipId: number, startSec: number, endSec: number) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Individual chapter thumbnail with start frame fallback */
function ChapterThumb({
  clipId,
  videoId,
  label,
  isCurrent,
}: {
  clipId?: number;
  videoId?: string | null;
  label: string;
  isCurrent: boolean;
}) {
  const [src, setSrc] = useState<string | null>(() => {
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    if (clipId) return `/api/clips/${clipId}/thumbnail`;
    return null;
  });
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setLoaded(false);
    if (videoId) {
      setSrc(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
    } else if (clipId) {
      setSrc(`/api/clips/${clipId}/thumbnail`);
    }
  }, [clipId, videoId]);

  // Fix race condition: if image loaded from cache before onLoad was attached
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  });

  const handleError = () => {
    if (videoId && src && !src.includes("hqdefault.jpg")) {
      setSrc(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
    }
    setLoaded(true);
  };

  if (!src) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.2)",
        }}
      >
        <Sparkles size={16} />
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(30, 41, 59, 0.85) 0%, rgba(51, 65, 85, 0.95) 50%, rgba(30, 41, 59, 0.85) 100%)",
            backgroundSize: "200% 100%",
            animation: "shimmerWave 1.6s infinite linear",
            zIndex: 1,
          }}
        />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={label}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        loading="eager"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? (isCurrent ? 1 : 0.78) : 0,
          transition: "opacity 0.25s ease, transform 0.2s ease",
        }}
      />
    </>
  );
}

export default function SmartTimeline({
  duration,
  currentTime = 0,
  clips,
  activeClipIndex,
  onJump,
  videoId,
  dbVideoId,
  onUpdateClipTimes,
}: SmartTimelineProps) {
  const [showSegments, setShowSegments] = useState(true);

  // Active clip & draggable range state
  const activeClip = activeClipIndex !== null && clips[activeClipIndex] ? clips[activeClipIndex] : null;

  const [rangeStart, setRangeStart] = useState<number>(() => activeClip?.start_seconds ?? 0);
  const [rangeEnd, setRangeEnd] = useState<number>(() => activeClip?.end_seconds ?? 30);
  const [isSavingRange, setIsSavingRange] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync range when activeClip changes
  useEffect(() => {
    if (activeClip) {
      setRangeStart(activeClip.start_seconds);
      setRangeEnd(activeClip.end_seconds);
      setSaveSuccess(false);
    }
  }, [activeClip?.id, activeClip?.start_seconds, activeClip?.end_seconds]);

  // Waveform container ref for dragging calculations
  const waveformRef = useRef<HTMLDivElement | null>(null);

  // Dragging state
  const [draggingMode, setDraggingMode] = useState<"start" | "end" | "move" | null>(null);
  const dragStartRef = useRef<{ clientX: number; initStart: number; initEnd: number }>({
    clientX: 0,
    initStart: 0,
    initEnd: 0,
  });

  // Generate 68 deterministic audio wave bars with varying heights
  const waveformBars = useMemo(() => {
    const barsCount = 68;
    const bars = [];
    for (let i = 0; i < barsCount; i++) {
      const heightFactor =
        0.25 +
        0.35 * Math.sin(i * 0.45) * Math.cos(i * 0.28) +
        0.2 * Math.sin(i * 1.2) +
        0.2 * Math.cos(i * 0.65);
      const clampedHeight = Math.max(0.18, Math.min(0.95, Math.abs(heightFactor)));
      bars.push({
        id: i,
        pct: (i / barsCount) * 100,
        heightPct: Math.round(clampedHeight * 100),
      });
    }
    return bars;
  }, []);

  // Compute chapter thumbnails from clips
  const chapters = useMemo(() => {
    if (!clips || clips.length === 0) return [];
    const sorted = [...clips].sort((a, b) => a.start_seconds - b.start_seconds);

    return sorted.slice(0, 6).map((c) => {
      // Find original index in props.clips
      const originalIdx = clips.findIndex((item) => item.id === c.id);
      let label = c.title || `Momento ${originalIdx + 1}`;
      if (label.length > 22) {
        label = label.substring(0, 20) + "...";
      }
      return {
        id: c.id,
        clipIndex: originalIdx >= 0 ? originalIdx : 0,
        startSeconds: c.start_seconds,
        endSeconds: c.end_seconds,
        timeLabel: formatTime(c.start_seconds),
        label: label,
      };
    });
  }, [clips]);

  // Detect time modification
  const isTimeModified = useMemo(() => {
    if (!activeClip) return false;
    return (
      Math.abs(rangeStart - activeClip.start_seconds) >= 0.75 ||
      Math.abs(rangeEnd - activeClip.end_seconds) >= 0.75
    );
  }, [activeClip, rangeStart, rangeEnd]);

  // Handle pointer down for dragging handles
  const handlePointerDown = (mode: "start" | "end" | "move", e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingMode(mode);
    dragStartRef.current = {
      clientX: e.clientX,
      initStart: rangeStart,
      initEnd: rangeEnd,
    };
  };

  // Global window pointer move and up during dragging
  useEffect(() => {
    if (!draggingMode || !waveformRef.current) return;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = waveformRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return;

      const deltaX = e.clientX - dragStartRef.current.clientX;
      const deltaSeconds = (deltaX / rect.width) * duration;

      const { initStart, initEnd } = dragStartRef.current;
      const minDuration = 3; // at least 3s

      if (draggingMode === "start") {
        const newStart = Math.max(0, Math.min(initEnd - minDuration, initStart + deltaSeconds));
        setRangeStart(Math.round(newStart * 2) / 2);
      } else if (draggingMode === "end") {
        const newEnd = Math.min(duration, Math.max(initStart + minDuration, initEnd + deltaSeconds));
        setRangeEnd(Math.round(newEnd * 2) / 2);
      } else if (draggingMode === "move") {
        const clipLen = initEnd - initStart;
        let newStart = initStart + deltaSeconds;
        let newEnd = initEnd + deltaSeconds;
        if (newStart < 0) {
          newStart = 0;
          newEnd = clipLen;
        } else if (newEnd > duration) {
          newEnd = duration;
          newStart = Math.max(0, duration - clipLen);
        }
        setRangeStart(Math.round(newStart * 2) / 2);
        setRangeEnd(Math.round(newEnd * 2) / 2);
      }
    };

    const handlePointerUp = () => {
      setDraggingMode(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingMode, duration]);

  // Waveform track click (jumps video time)
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSeconds = fraction * (duration || 300);
    onJump(targetSeconds);
  };

  // Save modified range
  const handleSaveRange = async () => {
    if (!activeClip?.id) return;
    setIsSavingRange(true);
    try {
      const res = await fetch(`/api/clips/${activeClip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_seconds: rangeStart,
          end_seconds: rangeEnd,
        }),
      });
      if (res.ok) {
        onUpdateClipTimes?.(activeClip.id, rangeStart, rangeEnd);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      // Error handling
    } finally {
      setIsSavingRange(false);
    }
  };

  const handleResetRange = () => {
    if (activeClip) {
      setRangeStart(activeClip.start_seconds);
      setRangeEnd(activeClip.end_seconds);
    }
  };

  // ── Transcript state & loader ──────────────────────────────────────────────
  const [transcriptData, setTranscriptData] = useState<{
    text: string;
    available: boolean;
    loading: boolean;
  }>({ text: "", available: false, loading: false });
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  // Fetch transcript for the active clip range
  useEffect(() => {
    const vid = dbVideoId;
    if (!vid) {
      setTranscriptData({ text: "", available: false, loading: false });
      return;
    }

    let isMounted = true;
    setTranscriptData((prev) => ({ ...prev, loading: true }));

    const url = `/api/videos/${vid}/transcript?start_seconds=${rangeStart}&end_seconds=${rangeEnd}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!isMounted) return;
        setTranscriptData({
          text: data.text || "",
          available: !!(data.available && data.text),
          loading: false,
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setTranscriptData({ text: "", available: false, loading: false });
      });

    return () => {
      isMounted = false;
    };
  }, [dbVideoId, activeClip?.id, rangeStart, rangeEnd]);

  const handleCopyTranscript = () => {
    if (!transcriptData.text) return;
    navigator.clipboard.writeText(transcriptData.text);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2500);
  };

  const currentPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const startPct = duration > 0 ? (rangeStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (rangeEnd / duration) * 100 : 0;
  const selectionWidthPct = Math.max(0.5, endPct - startPct);

  return (
    <div
      style={{
        background: "rgba(13, 17, 28, 0.8)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "16px",
        padding: "16px 20px",
        marginTop: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {/* Header Row: Title & Toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.01em" }}>
            Línea de tiempo inteligente
          </span>
          <span
            style={{
              fontSize: "10.5px",
              padding: "1px 7px",
              borderRadius: "99px",
              background: "rgba(56, 189, 248, 0.12)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.25)",
              fontWeight: 600,
            }}
          >
            IA Audio Track
          </span>
        </div>

        {/* Toggle Switch */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)", fontWeight: 500 }}>
            Mostrar segmentos
          </span>
          <button
            type="button"
            onClick={() => setShowSegments(!showSegments)}
            style={{
              width: "36px",
              height: "20px",
              borderRadius: "99px",
              background: showSegments ? "#0284c7" : "rgba(255, 255, 255, 0.15)",
              border: "none",
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s ease",
              padding: 0,
            }}
          >
            <div
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "#ffffff",
                position: "absolute",
                top: "2px",
                left: showSegments ? "18px" : "2px",
                transition: "left 0.2s ease",
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Waveform Visualizer Track with Draggable Selection */}
      <div
        ref={waveformRef}
        onClick={handleWaveformClick}
        style={{
          position: "relative",
          height: "66px",
          background: "rgba(0, 0, 0, 0.4)",
          borderRadius: "10px",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          cursor: "pointer",
          overflow: "hidden",
          userSelect: "none",
        }}
        title="Haz clic para navegar o arrastra el rango seleccionado"
      >
        {/* Audio Bars Grid */}
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "2px",
            pointerEvents: "none",
          }}
        >
          {waveformBars.map((b) => {
            const barSeconds = (b.pct / 100) * (duration || 300);
            const insideClip =
              showSegments &&
              clips.some((c) => barSeconds >= c.start_seconds && barSeconds <= c.end_seconds);

            return (
              <div
                key={b.id}
                style={{
                  flex: 1,
                  height: `${b.heightPct}%`,
                  borderRadius: "2px",
                  background: insideClip
                    ? "linear-gradient(180deg, #38bdf8 0%, #a855f7 100%)"
                    : b.pct <= currentPct
                      ? "rgba(56, 189, 248, 0.6)"
                      : "rgba(255, 255, 255, 0.15)",
                  transition: "height 0.15s ease, background 0.2s ease",
                  boxShadow: insideClip ? "0 0 6px rgba(56, 189, 248, 0.35)" : "none",
                }}
              />
            );
          })}
        </div>

        {/* ── DRAGGABLE SELECTION OVERLAY FOR ACTIVE CLIP ──────────────────────── */}
        {activeClip && showSegments && (
          <div
            style={{
              position: "absolute",
              left: `${startPct}%`,
              width: `${selectionWidthPct}%`,
              top: 0,
              bottom: 0,
              background: "rgba(56, 189, 248, 0.18)",
              borderTop: "2px solid #38bdf8",
              borderBottom: "2px solid #38bdf8",
              boxShadow: "0 0 16px rgba(56, 189, 248, 0.25)",
              zIndex: 11,
              pointerEvents: "auto",
              cursor: "grab",
            }}
            onPointerDown={(e) => handlePointerDown("move", e)}
            title="Arrastra para mover todo el rango del clip"
          >
            {/* Left Handle (Adjust Start) */}
            <div
              onPointerDown={(e) => handlePointerDown("start", e)}
              style={{
                position: "absolute",
                left: "-5px",
                top: 0,
                bottom: 0,
                width: "12px",
                cursor: "ew-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 13,
              }}
              title={`Arrastrar inicio (${formatTime(rangeStart)})`}
            >
              <div
                style={{
                  width: "4px",
                  height: "28px",
                  background: "#38bdf8",
                  borderRadius: "99px",
                  boxShadow: "0 0 8px #38bdf8",
                }}
              />
            </div>

            {/* Range Duration Tag in the center */}
            <div
              style={{
                position: "absolute",
                bottom: "4px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(15, 23, 42, 0.94)",
                border: "1px solid rgba(56, 189, 248, 0.5)",
                color: "#ffffff",
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "4px",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                fontVariantNumeric: "tabular-nums",
                boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                zIndex: 14,
              }}
            >
              {formatTime(rangeStart)} – {formatTime(rangeEnd)}
            </div>

            {/* Right Handle (Adjust End) */}
            <div
              onPointerDown={(e) => handlePointerDown("end", e)}
              style={{
                position: "absolute",
                right: "-5px",
                top: 0,
                bottom: 0,
                width: "12px",
                cursor: "ew-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 13,
              }}
              title={`Arrastrar fin (${formatTime(rangeEnd)})`}
            >
              <div
                style={{
                  width: "4px",
                  height: "28px",
                  background: "#38bdf8",
                  borderRadius: "99px",
                  boxShadow: "0 0 8px #38bdf8",
                }}
              />
            </div>
          </div>
        )}


        {/* Active Playhead Cursor */}
        <div
          style={{
            position: "absolute",
            left: `${currentPct}%`,
            top: 0,
            bottom: 0,
            width: "2px",
            background: "#ffffff",
            boxShadow: "0 0 8px rgba(255, 255, 255, 0.8)",
            zIndex: 15,
            pointerEvents: "none",
          }}
        >
          {/* Time floating badge */}
          <div
            style={{
              position: "absolute",
              top: "-8px",
              left: "50%",
              transform: "translateX(-50%) translateY(-100%)",
              background: "#0f172a",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              color: "#38bdf8",
              fontSize: "11px",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "4px",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            {formatTime(currentTime)}
          </div>
        </div>
      </div>

      {/* ── ACTION BAR: IF TIME WAS ADJUSTED ON TIMELINE ──────────────────────── */}
      {isTimeModified && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(14, 165, 233, 0.12)",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            borderRadius: "10px",
            padding: "8px 14px",
            animation: "fadeIn 0.2s ease",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sliders size={14} color="#38bdf8" />
            <span style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.9)" }}>
              Nuevo rango del clip:{" "}
              <strong style={{ color: "#38bdf8" }}>
                {formatTime(rangeStart)} – {formatTime(rangeEnd)}
              </strong>{" "}
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px" }}>
                ({Math.round(rangeEnd - rangeStart)} seg)
              </span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={handleResetRange}
              style={{
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                color: "rgba(255, 255, 255, 0.7)",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11.5px",
                cursor: "pointer",
              }}
            >
              Deshacer
            </button>
            <button
              type="button"
              onClick={handleSaveRange}
              disabled={isSavingRange}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                border: "1px solid rgba(56, 189, 248, 0.5)",
                color: "#ffffff",
                borderRadius: "6px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 0 12px rgba(56, 189, 248, 0.35)",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              {isSavingRange ? "Guardando..." : "✓ Actualizar tiempo del clip"}
            </button>
          </div>
        </div>
      )}

      {saveSuccess && (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.15)",
            border: "1px solid rgba(16, 185, 129, 0.35)",
            borderRadius: "8px",
            padding: "6px 12px",
            color: "#34d399",
            fontSize: "12px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Check size={14} /> ¡Tiempo del clip actualizado correctamente en la base de datos!
        </div>
      )}

      {/* Chapters / Moments Row with exact start frame thumbnails */}
      {chapters.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(6, chapters.length)}, minmax(0, 1fr))`,
            gap: "10px",
            overflowX: "auto",
            paddingBottom: "2px",
          }}
        >
          {chapters.map((ch) => {
            const isCurrent = activeClipIndex === ch.clipIndex;

            return (
              <div
                key={ch.id}
                onClick={() => onJump(ch.startSeconds, ch.clipIndex)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  cursor: "pointer",
                }}
              >
                {/* Thumbnail Card with exact first frame */}
                <div
                  style={{
                    position: "relative",
                    aspectRatio: "16 / 9",
                    borderRadius: "8px",
                    overflow: "hidden",
                    background: "#1e293b",
                    border: isCurrent
                      ? "2px solid #38bdf8"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                    boxShadow: isCurrent ? "0 0 12px rgba(56, 189, 248, 0.35)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <ChapterThumb
                    clipId={ch.id}
                    videoId={videoId}
                    label={ch.label}
                    isCurrent={isCurrent}
                  />

                  {/* Timestamp Pill in bottom left */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: "4px",
                      left: "4px",
                      background: "rgba(0, 0, 0, 0.8)",
                      backdropFilter: "blur(4px)",
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: "4px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {ch.timeLabel}
                  </div>
                </div>

                {/* Chapter Label below */}
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? "#38bdf8" : "rgba(255, 255, 255, 0.7)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textAlign: "left",
                  }}
                  title={ch.label}
                >
                  {ch.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── FULL TRANSCRIPTION SECTION FOR ACTIVE CLIP ──────────────────────── */}
      {activeClip && (
        <div
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: "12px",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginTop: "4px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FileText size={15} color="#38bdf8" />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff" }}>
                Transcripción Completa del Momento
              </span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 7px",
                  borderRadius: "99px",
                  background: "rgba(56, 189, 248, 0.12)",
                  color: "#38bdf8",
                  fontWeight: 600,
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                }}
              >
                ⏱ {formatTime(rangeStart)} – {formatTime(rangeEnd)}
              </span>
            </div>

            {transcriptData.available && (
              <button
                type="button"
                onClick={handleCopyTranscript}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: copiedTranscript ? "#34d399" : "rgba(255, 255, 255, 0.8)",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "11.5px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  transition: "all 0.15s ease",
                }}
                title="Copiar transcripción completa del clip"
              >
                {copiedTranscript ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedTranscript ? "¡Copiado!" : "Copiar texto"}</span>
              </button>
            )}
          </div>

          {/* Transcript Content */}
          <div
            style={{
              fontSize: "13px",
              lineHeight: 1.6,
              color: "rgba(255, 255, 255, 0.85)",
              maxHeight: "300px",
              overflowY: "auto",
              paddingRight: "6px",
            }}
          >
            {transcriptData.loading ? (
              <span style={{ color: "rgba(255, 255, 255, 0.4)", fontStyle: "italic" }}>
                Cargando diálogo completo del momento...
              </span>
            ) : transcriptData.available ? (
              <p style={{ margin: 0 }}>
                <span style={{ color: "#38bdf8", fontWeight: 700, marginRight: "4px" }}>“</span>
                {transcriptData.text}
                <span style={{ color: "#38bdf8", fontWeight: 700, marginLeft: "4px" }}>”</span>
              </p>
            ) : (
              <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.4)", fontStyle: "italic" }}>
                Transcripción no disponible para este segmento del video.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
