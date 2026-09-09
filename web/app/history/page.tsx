"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface VideoData {
  id: number;
  source_url: string | null;
  source_path: string | null;
  cliente: string | null;
  title: string | null;
  duration_seconds: number;
  created_at: string;
  clips_count: number;
  status_summary: {
    prospecto: number;
    subtitulado: number;
    en_revision: number;
    publicado: number;
  };
}

interface ClipData {
  id: number;
  video_id: number;
  start_seconds: number;
  end_seconds: number;
  title: string;
  reason: string;
  score: number;
  status: string;
  caption: string | null;
  hashtags: string | null;
  output_path: string | null;
  video_source?: string;
  cliente?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  prospecto: { label: "Prospecto", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)" },
  enfoque_generado: { label: "9:16 Listo", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" },
  subtitulado: { label: "Subtitulado", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.15)" },
  en_revision: { label: "En Revisión", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" },
  publicado: { label: "Publicado", color: "#22c55e", bg: "rgba(34, 197, 94, 0.15)" },
  descartado: { label: "Descartado", color: "#64748b", bg: "rgba(100, 116, 139, 0.12)" },
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s}s`;
}

export default function HistoryPage() {
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"videos" | "clips">("videos");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, [selectedStatus, selectedClient]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch videos
      const vidRes = await fetch("/api/videos");
      if (vidRes.ok) {
        const vData: VideoData[] = await vidRes.json();
        setVideos(vData);
      }

      // Fetch clips with filter
      let clipUrl = "/api/clips";
      const params = new URLSearchParams();
      if (selectedStatus !== "all") params.append("status", selectedStatus);
      if (selectedClient !== "all") params.append("cliente", selectedClient);
      if (params.toString()) clipUrl += `?${params.toString()}`;

      const clipRes = await fetch(clipUrl);
      if (clipRes.ok) {
        const cData: ClipData[] = await clipRes.json();
        setClips(cData);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  };

  const handleUpdateStatus = async (clipId: number, newStatus: string) => {
    try {
      await fetch(`/api/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      // update local
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, status: newStatus } : c))
      );
    } catch {
      // ignore
    }
  };

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Distinct clients list
  const clientList = Array.from(
    new Set(videos.map((v) => v.cliente).filter(Boolean))
  ) as string[];

  const totalClips = videos.reduce((acc, v) => acc + (v.clips_count || 0), 0);
  const pendingClips = videos.reduce(
    (acc, v) => acc + (v.status_summary?.en_revision || 0),
    0
  );
  const publishedClips = videos.reduce(
    (acc, v) => acc + (v.status_summary?.publicado || 0),
    0
  );

  return (
    <div className="page-wrapper">
      <div className="bg-orbs">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
      </div>

      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "16px 0",
          background: "rgba(10, 10, 15, 0.8)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/" className="logo" style={{ textDecoration: "none" }}>
              <Image
                src="/logo-clypfast.png"
                alt="ClypFast"
                width={130}
                height={30}
                style={{ height: "26px", width: "auto", objectFit: "contain" }}
              />
            </Link>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: "rgba(167, 139, 250, 0.15)",
                color: "#a78bfa",
                borderRadius: 99,
                fontWeight: 600,
              }}
            >
              Panel de Agencia
            </span>
          </div>

          <Link href="/" className="btn-primary" style={{ padding: "8px 16px", fontSize: 13, textDecoration: "none" }}>
            + Nuevo Análisis
          </Link>
        </div>
      </header>

      <main style={{ padding: "32px 0 60px 0" }}>
        <div className="container">
          {/* Title & Stats */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
              📁 Historial de Contenido y Clientes
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              Administra el ciclo de vida de los clips, copies para redes y entregas a tus clientes.
            </p>
          </div>

          {/* Metric Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 32,
            }}
          >
            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                📼 Videos Procesados
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)" }}>
                {videos.length}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                🎯 Clips Virales Totales
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--cyan)" }}>
                {totalClips}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 4 }}>
                ⏳ Pendientes de Revisión
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b" }}>
                {pendingClips}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 4 }}>
                🚀 Clips Publicados
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}>
                {publishedClips}
              </div>
            </div>
          </div>

          {/* Filters Bar */}
          <div
            className="glass-card"
            style={{
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 14,
              marginBottom: 24,
            }}
          >
            {/* Tab switch */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={activeTab === "videos" ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab("videos")}
                style={{ padding: "6px 14px", fontSize: 13 }}
              >
                📼 Videos ({videos.length})
              </button>
              <button
                type="button"
                className={activeTab === "clips" ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab("clips")}
                style={{ padding: "6px 14px", fontSize: 13 }}
              >
                🎯 Clips Detallados ({clips.length})
              </button>
            </div>

            {/* Filter controls */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>
                  Cliente:
                </label>
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "#fff",
                    border: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <option value="all">Todos los clientes</option>
                  {clientList.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>
                  Estado:
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "#fff",
                    border: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <option value="all">Todos los estados</option>
                  <option value="prospecto">⚪ Prospecto</option>
                  <option value="subtitulado">🟣 Subtitulado</option>
                  <option value="en_revision">🟠 En Revisión</option>
                  <option value="publicado">🟢 Publicado</option>
                  <option value="descartado">⚪ Descartado</option>
                </select>
              </div>
            </div>
          </div>

          {/* Tab 1: Videos View */}
          {activeTab === "videos" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {videos.length === 0 ? (
                <div className="glass-card" style={{ padding: 40, textAlign: "center" }}>
                  <span style={{ fontSize: 36 }}>📂</span>
                  <h3 style={{ marginTop: 12, marginBottom: 6 }}>No hay videos guardados aún</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    Inicia un análisis desde la página principal y se guardará automáticamente aquí.
                  </p>
                </div>
              ) : (
                videos.map((vid) => (
                  <div
                    key={vid.id}
                    className="glass-card"
                    style={{
                      padding: "18px 22px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        {vid.cliente && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 8px",
                              background: "rgba(167, 139, 250, 0.2)",
                              color: "#a78bfa",
                              borderRadius: 6,
                            }}
                          >
                            🏷️ {vid.cliente}
                          </span>
                        )}
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                          {vid.title || "Video"}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
                        <span>⏱ {formatDuration(vid.duration_seconds)}</span>
                        <span>📅 {new Date(vid.created_at).toLocaleDateString()}</span>
                        {vid.source_url && (
                          <a
                            href={vid.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--cyan)", textDecoration: "none" }}
                          >
                            ↗ Ver en YouTube
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Status Pill Summary */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 10px",
                          borderRadius: 99,
                          background: "rgba(34, 211, 238, 0.12)",
                          color: "var(--cyan)",
                          fontWeight: 600,
                        }}
                      >
                        {vid.clips_count} clips
                      </span>

                      {vid.status_summary?.subtitulado > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "3px 8px",
                            borderRadius: 99,
                            background: "rgba(167, 139, 250, 0.2)",
                            color: "#a78bfa",
                          }}
                        >
                          🟣 {vid.status_summary.subtitulado} listos
                        </span>
                      )}

                      {vid.status_summary?.en_revision > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "3px 8px",
                            borderRadius: 99,
                            background: "rgba(245, 158, 11, 0.2)",
                            color: "#f59e0b",
                          }}
                        >
                          🟠 {vid.status_summary.en_revision} en revisión
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 2: Detailed Clips View */}
          {activeTab === "clips" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {clips.length === 0 ? (
                <div className="glass-card" style={{ padding: 40, textAlign: "center" }}>
                  <span style={{ fontSize: 36 }}>🎯</span>
                  <h3 style={{ marginTop: 12, marginBottom: 6 }}>No hay clips que coincidan</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    Ajusta los filtros de cliente o estado para ver más resultados.
                  </p>
                </div>
              ) : (
                clips.map((c) => {
                  const sMeta = STATUS_CONFIG[c.status] || STATUS_CONFIG.prospecto;
                  const fullCopy = `${c.caption || c.title}\n\n${c.hashtags || ""}`.trim();

                  return (
                    <div
                      key={c.id}
                      className="glass-card"
                      style={{
                        padding: "18px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            {c.cliente && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  background: "rgba(167, 139, 250, 0.15)",
                                  color: "#a78bfa",
                                  borderRadius: 4,
                                }}
                              >
                                {c.cliente}
                              </span>
                            )}
                            <select
                              value={c.status}
                              onChange={(e) => handleUpdateStatus(c.id, e.target.value)}
                              style={{
                                color: sMeta.color,
                                background: sMeta.bg,
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: 99,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 600,
                                outline: "none",
                              }}
                            >
                              <option value="prospecto">⚪ Prospecto</option>
                              <option value="enfoque_generado">🔵 9:16 Listo</option>
                              <option value="subtitulado">🟣 Subtitulado</option>
                              <option value="en_revision">🟠 En Revisión</option>
                              <option value="publicado">🟢 Publicado</option>
                              <option value="descartado">⚪ Descartado</option>
                            </select>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              ⏱ {Math.round(c.start_seconds)}s → {Math.round(c.end_seconds)}s
                            </span>
                          </div>

                          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
                            {c.title}
                          </h3>
                        </div>

                        <div
                          style={{
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "rgba(34, 197, 94, 0.15)",
                            color: "#4ade80",
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          🔥 {c.score}/10
                        </div>
                      </div>

                      {/* Social copy */}
                      {c.caption && (
                        <div
                          style={{
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            borderRadius: 6,
                            padding: "8px 12px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                            <span style={{ color: "#e2e8f0", fontStyle: "italic" }}>"{c.caption}"</span>
                            {c.hashtags && (
                              <div style={{ color: "#a78bfa", marginTop: 2, fontSize: 11 }}>
                                {c.hashtags}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCopy(c.id, fullCopy)}
                            className="btn-secondary"
                            style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
                          >
                            {copiedId === c.id ? "✓ Copiado" : "📋 Copiar"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
