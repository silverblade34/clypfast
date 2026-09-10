"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { buildPostDescription } from "@/components/ClipCard";

interface VideoData {
  id: number;
  source_url: string | null;
  source_path: string | null;
  cliente: string | null;
  channel?: string | null;
  title: string | null;
  duration_seconds: number;
  created_at: string;
  clips_count: number;
  provider?: string | null;
  llm_model?: string | null;
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
  video_title?: string;
  channel?: string;
  cliente?: string;
  provider?: string | null;
  llm_model?: string | null;
}

interface StorageData {
  total_bytes: number;
  total_mb: number;
  clips_mb: number;
  thumbs_mb: number;
  data_mb: number;
  orphaned_mb: number;
  orphaned_count: number;
  orphaned_folders: { folder: string; bytes: number; mb: number }[];
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
  const [selectedModel, setSelectedModel] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"videos" | "clips">("videos");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState<VideoData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [showStorageModal, setShowStorageModal] = useState(false);

  useEffect(() => {
    fetchData();
    fetchStorage();
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

  const fetchStorage = async () => {
    try {
      const res = await fetch("/api/storage");
      if (res.ok) {
        const sData: StorageData = await res.json();
        setStorage(sData);
      }
    } catch {
      // ignore
    }
  };

  const showToast = (text: string, isError = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleConfirmDelete = async () => {
    if (!deletingVideo) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/videos/${deletingVideo.id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setVideos((prev) => prev.filter((v) => v.id !== deletingVideo.id));
        setClips((prev) => prev.filter((c) => c.video_id !== deletingVideo.id));
        showToast(data.message || "Video y archivos eliminados exitosamente");
        setDeletingVideo(null);
        fetchStorage();
      } else {
        showToast(data.detail || "Error al eliminar video", true);
      }
    } catch {
      showToast("Error de conexión al eliminar el video", true);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCleanOrphans = async () => {
    setCleaningOrphans(true);
    try {
      const res = await fetch("/api/storage", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Archivos huérfanos eliminados");
        fetchStorage();
      } else {
        showToast(data.detail || "Error al limpiar huérfanos", true);
      }
    } catch {
      showToast("Error de conexión al limpiar huérfanos", true);
    } finally {
      setCleaningOrphans(false);
    }
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

  const filteredVideos = videos.filter((v) => {
    if (selectedClient !== "all" && v.cliente !== selectedClient) return false;
    if (selectedModel !== "all") {
      const prov = (v.provider || "gemini").toLowerCase();
      if (prov !== selectedModel.toLowerCase()) return false;
    }
    return true;
  });

  const filteredClips = clips.filter((c) => {
    if (selectedModel !== "all") {
      const prov = (c.provider || "gemini").toLowerCase();
      if (prov !== selectedModel.toLowerCase()) return false;
    }
    return true;
  });

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

            <div
              className="glass-card"
              style={{
                padding: 18,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                background: "linear-gradient(180deg, rgba(34, 211, 238, 0.04) 0%, rgba(255, 255, 255, 0.03) 100%)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 600 }}>
                    💾 Espacio en Disco
                  </div>
                  {storage && storage.orphaned_count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 99,
                        background: "rgba(245, 158, 11, 0.2)",
                        color: "#f59e0b",
                        fontWeight: 700,
                      }}
                      title="Archivos temporales antiguos sin video registrado"
                    >
                      {storage.orphaned_count} huérfanos
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)" }}>
                  {storage ? `${storage.total_mb} MB` : "..."}
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowStorageModal(true)}
                  style={{
                    padding: "4px 8px",
                    fontSize: 11,
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  🔍 Desglose
                </button>
                {storage && storage.orphaned_count > 0 && (
                  <button
                    type="button"
                    onClick={handleCleanOrphans}
                    disabled={cleaningOrphans}
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#f59e0b",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      borderRadius: 6,
                      cursor: cleaningOrphans ? "not-allowed" : "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {cleaningOrphans ? "Limpiando..." : "🧹 Limpiar"}
                  </button>
                )}
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

              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>
                  Modelo IA:
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.06)",
                    color: "#fff",
                    border: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <option value="all">⚡ Groq + ✨ Gemini (Todos)</option>
                  <option value="groq">⚡ Groq</option>
                  <option value="gemini">✨ Gemini</option>
                </select>
              </div>
            </div>
          </div>

          {/* Tab 1: Videos View */}
          {activeTab === "videos" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {filteredVideos.length === 0 ? (
                  <div className="glass-card" style={{ padding: 40, textAlign: "center" }}>
                    <span style={{ fontSize: 36 }}>📂</span>
                    <h3 style={{ marginTop: 12, marginBottom: 6 }}>No hay videos que coincidan</h3>
                    <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      {videos.length === 0
                        ? "Inicia un análisis desde la página principal y se guardará automáticamente aquí."
                        : "Prueba seleccionando otro filtro de modelo o cliente."}
                    </p>
                  </div>
                ) : (
                  filteredVideos.map((vid) => (
                    <div
                      key={vid.id}
                      className="glass-card"
                      style={{
                        padding: "20px 24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 20,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: "1 1 420px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 8px",
                              background:
                                (vid.provider || "gemini").toLowerCase() === "groq"
                                  ? "rgba(249, 115, 22, 0.18)"
                                  : "rgba(168, 85, 247, 0.18)",
                              color:
                                (vid.provider || "gemini").toLowerCase() === "groq"
                                  ? "#fb923c"
                                  : "#c084fc",
                              borderRadius: 6,
                              border: `1px solid ${
                                (vid.provider || "gemini").toLowerCase() === "groq"
                                  ? "rgba(249, 115, 22, 0.35)"
                                  : "rgba(168, 85, 247, 0.35)"
                              }`,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {(vid.provider || "gemini").toLowerCase() === "groq" ? "⚡ Groq" : "✨ Gemini"}
                          </span>

                          {vid.channel && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "3px 9px",
                                background: "rgba(34, 211, 238, 0.12)",
                                color: "var(--cyan)",
                                borderRadius: 6,
                                border: "1px solid rgba(34, 211, 238, 0.25)",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              📺 {vid.channel}
                            </span>
                          )}
                          {vid.cliente && (
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
                              🏷️ {vid.cliente}
                            </span>
                          )}
                        </div>

                        <div style={{ marginBottom: 8 }}>
                          <Link
                            href={`/analyze/db/${vid.id}`}
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: "#fff",
                              textDecoration: "none",
                              lineHeight: 1.4,
                              display: "inline-block",
                            }}
                            title="Haz clic para entrar al panel de clips"
                          >
                            {vid.title || `Video #${vid.id}`}
                          </Link>
                        </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 14,
                          fontSize: 12,
                          color: "var(--text-muted)",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>⏱ {formatDuration(vid.duration_seconds)}</span>
                        <span>
                          📅 {new Date(vid.created_at).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
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

                    {/* Status Pill Summary & Action Button */}
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: "4px 10px",
                            borderRadius: 99,
                            background: "rgba(34, 211, 238, 0.12)",
                            color: "var(--cyan)",
                            fontWeight: 700,
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

                      <Link
                        href={`/analyze/db/${vid.id}`}
                        className="btn-primary"
                        style={{
                          padding: "8px 16px",
                          fontSize: 13,
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          borderRadius: 8,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                        id={`open-panel-${vid.id}`}
                      >
                        🎬 Abrir panel de clips →
                      </Link>

                      <button
                        type="button"
                        onClick={() => setDeletingVideo(vid)}
                        style={{
                          padding: "8px 12px",
                          fontSize: 13,
                          background: "rgba(239, 68, 68, 0.1)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.25)",
                          borderRadius: 8,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          transition: "all 0.2s ease",
                          whiteSpace: "nowrap",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)";
                          e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.6)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                          e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.25)";
                        }}
                        title="Eliminar este video del historial y liberar archivos del disco"
                        id={`delete-video-${vid.id}`}
                      >
                        🗑️ Eliminar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 2: Detailed Clips View */}
          {activeTab === "clips" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {filteredClips.length === 0 ? (
                  <div className="glass-card" style={{ padding: 40, textAlign: "center" }}>
                    <span style={{ fontSize: 36 }}>🎯</span>
                    <h3 style={{ marginTop: 12, marginBottom: 6 }}>No hay clips que coincidan</h3>
                    <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      Ajusta los filtros de cliente, estado o modelo para ver más resultados.
                    </p>
                  </div>
                ) : (
                  filteredClips.map((c) => {
                    const sMeta = STATUS_CONFIG[c.status] || STATUS_CONFIG.prospecto;
                    const fullCopy = buildPostDescription({
                      caption: c.caption || undefined,
                      reason: c.reason,
                      title: c.title,
                      videoTitle: c.video_title,
                      videoChannel: c.channel,
                      videoUrl: c.video_source,
                      startSec: c.start_seconds,
                      hashtags: c.hashtags || undefined,
                    });

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
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: "2px 7px",
                                  background:
                                    (c.provider || "gemini").toLowerCase() === "groq"
                                      ? "rgba(249, 115, 22, 0.18)"
                                      : "rgba(168, 85, 247, 0.18)",
                                  color:
                                    (c.provider || "gemini").toLowerCase() === "groq"
                                      ? "#fb923c"
                                      : "#c084fc",
                                  borderRadius: 4,
                                  border: `1px solid ${
                                    (c.provider || "gemini").toLowerCase() === "groq"
                                      ? "rgba(249, 115, 22, 0.3)"
                                      : "rgba(168, 85, 247, 0.3)"
                                  }`,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                }}
                              >
                                {(c.provider || "gemini").toLowerCase() === "groq" ? "⚡ Groq" : "✨ Gemini"}
                              </span>

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

                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Link
                              href={`/analyze/db/${c.video_id}`}
                              className="btn-secondary"
                              style={{ padding: "4px 10px", fontSize: 11, textDecoration: "none", whiteSpace: "nowrap" }}
                            >
                              🎬 Abrir en panel →
                            </Link>
                            <Link
                              href={`/editor?clipId=${c.id}&returnUrl=/history`}
                              className="btn-secondary"
                              style={{ padding: "4px 10px", fontSize: 11, textDecoration: "none", whiteSpace: "nowrap" }}
                              title="Abrir en el editor Mini-CapCut"
                            >
                              ✂️ Mini-CapCut
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleCopy(c.id, fullCopy)}
                              className="btn-secondary"
                              style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
                            >
                              {copiedId === c.id ? "✓ Copiado" : "📋 Copiar"}
                            </button>
                          </div>
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

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: toastMessage.isError ? "rgba(239, 68, 68, 0.95)" : "rgba(16, 185, 129, 0.95)",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            fontSize: 14,
            fontWeight: 600,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 8,
            backdropFilter: "blur(8px)",
          }}
        >
          <span>{toastMessage.isError ? "❌" : "✅"}</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Modal Confirmación de Eliminación */}
      {deletingVideo && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => !isDeleting && setDeletingVideo(null)}
        >
          <div
            className="glass-card"
            style={{
              maxWidth: 520,
              width: "100%",
              background: "#0c0c1a",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: 16,
              padding: "24px 28px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.85)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                }}
              >
                🗑️
              </div>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>
                  ¿Eliminar análisis del historial?
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                  Esta acción liberará espacio en disco y limpiará los registros.
                </p>
              </div>
            </div>

            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "#f1f5f9", marginBottom: 6 }}>
                {deletingVideo.title || `Video #${deletingVideo.id}`}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                {deletingVideo.cliente && <span>🏢 {deletingVideo.cliente}</span>}
                <span>⏱ {formatDuration(deletingVideo.duration_seconds)}</span>
                <span style={{ color: "var(--cyan)", fontWeight: 600 }}>🎯 {deletingVideo.clips_count} clips asociados</span>
              </div>
            </div>

            <div
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 20,
                fontSize: 12,
                lineHeight: 1.5,
                color: "#fca5a5",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4, color: "#f87171" }}>
                ⚠️ Archivos que serán borrados del disco:
              </strong>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>Clips renderizados en formato vertical (.mp4) asociados.</li>
                <li>Archivos de audio, transcripción y reportes si ningún otro análisis los utiliza.</li>
                <li>Miniaturas cacheadas en <code>outputs/thumbs</code>.</li>
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setDeletingVideo(null)}
                disabled={isDeleting}
                style={{
                  padding: "10px 18px",
                  fontSize: 13,
                  background: "rgba(255, 255, 255, 0.07)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                style={{
                  padding: "10px 20px",
                  fontSize: 13,
                  background: "linear-gradient(135deg, #dc2626, #991b1b)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 4px 15px rgba(220, 38, 38, 0.4)",
                }}
                id="confirm-delete-btn"
              >
                {isDeleting ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Liberando espacio...
                  </>
                ) : (
                  "🗑️ Sí, eliminar y liberar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Desglose de Almacenamiento */}
      {showStorageModal && storage && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setShowStorageModal(false)}
        >
          <div
            className="glass-card"
            style={{
              maxWidth: 540,
              width: "100%",
              background: "#0c0c1a",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "24px 28px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.85)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                💾 Desglose de Almacenamiento en Disco
              </h3>
              <button
                type="button"
                onClick={() => setShowStorageModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: 20,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: 14, borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>TOTAL EN OUTPUTS</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--cyan)" }}>{storage.total_mb} MB</div>
              </div>
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: 14, borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>CLIPS RENDERIZADOS (.MP4)</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#a78bfa" }}>{storage.clips_mb} MB</div>
              </div>
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: 14, borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>TRANSCRIPCIONES Y REPORTES</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#38bdf8" }}>{storage.data_mb} MB</div>
              </div>
              <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: 14, borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>MINIATURAS CACHEADAS</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#94a3b8" }}>{storage.thumbs_mb} MB</div>
              </div>
            </div>

            {storage.orphaned_count > 0 && (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.08)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 20,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: "#f59e0b", fontSize: 13 }}>
                    🧹 {storage.orphaned_count} carpetas huérfanas detectadas ({storage.orphaned_mb} MB)
                  </span>
                  <button
                    type="button"
                    onClick={handleCleanOrphans}
                    disabled={cleaningOrphans}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      background: "#f59e0b",
                      color: "#000",
                      border: "none",
                      borderRadius: 6,
                      fontWeight: 700,
                      cursor: cleaningOrphans ? "not-allowed" : "pointer",
                    }}
                  >
                    {cleaningOrphans ? "Limpiando..." : "Limpiar ahora"}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                  Archivos de análisis antiguos que ya no están registrados en la base de datos (por ejemplo audios pesados de ejecuciones interrumpidas).
                </p>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowStorageModal(false)}
                className="btn-primary"
                style={{ padding: "8px 20px", fontSize: 13 }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
