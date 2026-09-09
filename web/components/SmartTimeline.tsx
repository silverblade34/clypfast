"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { Clip } from "./ClipCard";

interface SmartTimelineProps {
  duration: number;
  currentTime?: number;
  clips: Clip[];
  activeClipIndex: number | null;
  onJump: (seconds: number, index?: number) => void;
  videoId?: string | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function SmartTimeline({
  duration,
  currentTime = 0,
  clips,
  activeClipIndex,
  onJump,
  videoId,
}: SmartTimelineProps) {
  const [showSegments, setShowSegments] = useState(true);

  // Generate 64 deterministic audio wave bars with varying heights
  const waveformBars = useMemo(() => {
    const barsCount = 68;
    const bars = [];
    for (let i = 0; i < barsCount; i++) {
      // Deterministic pseudo-random variation based on sine/cosine
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

  // Compute chapter thumbnails from clips or generated intervals
  const chapters = useMemo(() => {
    if (!clips || clips.length === 0) return [];
    
    // Sort clips by start time
    const sorted = [...clips].sort((a, b) => a.start_seconds - b.start_seconds);

    return sorted.slice(0, 6).map((c, idx) => {
      // Short label from title
      let label = c.title || `Momento ${idx + 1}`;
      if (label.length > 20) {
        label = label.substring(0, 18) + "...";
      }
      return {
        id: c.id ?? idx,
        clipIndex: idx,
        startSeconds: c.start_seconds,
        endSeconds: c.end_seconds,
        timeLabel: formatTime(c.start_seconds),
        label: label,
      };
    });
  }, [clips]);

  // Handle clicking on waveform track
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSeconds = fraction * (duration || 300);
    onJump(targetSeconds);
  };

  const currentPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 15;

  return (
    <div
      style={{
        background: "rgba(13, 17, 28, 0.75)",
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

      {/* Waveform Visualizer Track */}
      <div
        onClick={handleWaveformClick}
        style={{
          position: "relative",
          height: "64px",
          background: "rgba(0, 0, 0, 0.35)",
          borderRadius: "10px",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          cursor: "pointer",
          overflow: "hidden",
        }}
        title="Haz clic para navegar a cualquier punto del video"
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
          }}
        >
          {waveformBars.map((b) => {
            // Check if this bar falls inside any clip segment
            const barSeconds = (b.pct / 100) * (duration || 300);
            const insideClip = showSegments && clips.some(
              (c) => barSeconds >= c.start_seconds && barSeconds <= c.end_seconds
            );

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
                  boxShadow: insideClip ? "0 0 6px rgba(56, 189, 248, 0.4)" : "none",
                }}
              />
            );
          })}
        </div>

        {/* Clip Pin Markers along timeline */}
        {showSegments &&
          clips.map((c, i) => {
            const pinPct = duration > 0 ? (c.start_seconds / duration) * 100 : 0;
            const isSelected = activeClipIndex === i;
            return (
              <div
                key={c.id ?? i}
                onClick={(e) => {
                  e.stopPropagation();
                  onJump(c.start_seconds, i);
                }}
                style={{
                  position: "absolute",
                  left: `${pinPct}%`,
                  top: "6px",
                  transform: "translateX(-50%)",
                  width: isSelected ? "10px" : "7px",
                  height: isSelected ? "10px" : "7px",
                  borderRadius: "50%",
                  background: isSelected ? "#38bdf8" : "#c084fc",
                  border: "1.5px solid #ffffff",
                  boxShadow: isSelected ? "0 0 10px #38bdf8" : "0 0 6px rgba(192, 132, 252, 0.6)",
                  cursor: "pointer",
                  zIndex: 10,
                }}
                title={`Clip #${i + 1}: ${c.title} (${formatTime(c.start_seconds)})`}
              />
            );
          })}

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
            zIndex: 12,
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

      {/* Chapters / Moments Row */}
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
            const thumbUrl = videoId
              ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
              : null;

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
                {/* Thumbnail Card */}
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
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={ch.label}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        opacity: isCurrent ? 1 : 0.8,
                      }}
                    />
                  ) : (
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
                  )}

                  {/* Timestamp Pill in bottom left */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: "4px",
                      left: "4px",
                      background: "rgba(0, 0, 0, 0.75)",
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
    </div>
  );
}
