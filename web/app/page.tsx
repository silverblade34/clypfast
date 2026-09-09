"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Link2,
  ArrowRight,
  Sparkles,
  Zap,
  Film,
  Tag,
  FileText,
  Play,
  BarChart3,
  ShieldCheck,
  Compass,
  Mic,
  Landmark,
  Gamepad2,
  GraduationCap,
  Smile,
  Globe,
  ChevronDown,
  AlertCircle,
  Loader2,
  Server,
  Cloud,
  Subtitles,
  RefreshCw,
  X,
  Plus,
  Bot,
} from "lucide-react";
import styles from "./page.module.css";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [cliente, setCliente] = useState("");
  const [contentType, setContentType] = useState("vlog");
  const [transcriptionEngine, setTranscriptionEngine] = useState("auto");
  const [whisperModel, setWhisperModel] = useState("small");
  const [maxClips, setMaxClips] = useState("12");
  const [provider, setProvider] = useState<"groq" | "gemini">("groq");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Clientes registrados en historial y memoria local
  const [clientList, setClientList] = useState<string[]>([]);
  const [isCreatingNewClient, setIsCreatingNewClient] = useState(false);

  // Pre-check historial: si la URL ya fue procesada
  const [historyMatch, setHistoryMatch] = useState<{
    id: number;
    title: string;
    clips_count: number;
    provider?: string | null;
    llm_model?: string | null;
  } | null>(null);
  const [checkingHistory, setCheckingHistory] = useState(false);
  // Permite al usuario ignorar la coincidencia para re-analizar con nuevos parámetros
  const [dismissedMatchUrl, setDismissedMatchUrl] = useState<string | null>(null);

  // ── Restaurar preferencias y cargar clientes al montar ───────────────
  useEffect(() => {
    // 1. Restaurar última selección de tipo de contenido y proveedor
    try {
      const savedType = localStorage.getItem("clypfast_last_content_type");
      if (savedType) {
        setContentType(savedType);
      }
      const savedProvider = localStorage.getItem("clypfast_preferred_provider") as "groq" | "gemini" | null;
      if (savedProvider && (savedProvider === "groq" || savedProvider === "gemini")) {
        setProvider(savedProvider);
      }
    } catch {}

    // 2. Cargar lista de clientes (Backend SQLite + localStorage)
    async function loadClients() {
      let dbClients: string[] = [];
      try {
        const res = await fetch("/api/clients");
        if (res.ok) {
          dbClients = await res.json();
        }
      } catch {}

      let localClients: string[] = [];
      try {
        const stored = localStorage.getItem("clypfast_custom_clients");
        if (stored) {
          localClients = JSON.parse(stored);
        }
      } catch {}

      const merged = Array.from(
        new Set([...dbClients, ...localClients].map((c) => c.trim()).filter(Boolean))
      );
      setClientList(merged);
    }
    loadClients();
  }, []);

  const isYouTubeUrl = (u: string) => /youtube\.com|youtu\.be/.test(u);

  /** Busca en la DB si la URL ya fue analizada. Se llama al perder el foco del input o al pegar. */
  async function checkHistory(inputUrl: string) {
    const cleanUrl = inputUrl.trim();
    if (!cleanUrl || !isYouTubeUrl(cleanUrl) || cleanUrl === dismissedMatchUrl) {
      setHistoryMatch(null);
      return;
    }
    setCheckingHistory(true);
    try {
      const res = await fetch(`/api/videos/lookup?url=${encodeURIComponent(cleanUrl)}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryMatch({ id: data.id, title: data.title, clips_count: data.clips_count });
      } else {
        setHistoryMatch(null);
      }
    } catch {
      setHistoryMatch(null);
    } finally {
      setCheckingHistory(false);
    }
  }

  /**
   * Ejecuta el análisis.
   * @param forceNew Si es true, ignora el historial y procesa el video desde cero con IA.
   */
  async function triggerAnalysis(forceNew = false) {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!isYouTubeUrl(cleanUrl)) {
      setError("Por favor ingresa una URL válida de YouTube.");
      return;
    }

    // Si no es forzado y hay coincidencia en historial con EL MISMO MODELO, redirigir directo.
    // Si el usuario eligió un proveedor distinto (ej. Groq vs Gemini), se permite analizar para comparar.
    if (!forceNew) {
      if (historyMatch && cleanUrl !== dismissedMatchUrl) {
        if (historyMatch.provider === provider) {
          router.push(`/analyze/db/${historyMatch.id}`);
          return;
        }
      }

      if (cleanUrl !== dismissedMatchUrl) {
        try {
          const lookupRes = await fetch(`/api/videos/lookup?url=${encodeURIComponent(cleanUrl)}`);
          if (lookupRes.ok) {
            const existing = await lookupRes.json();
            if (existing.provider === provider) {
              router.push(`/analyze/db/${existing.id}`);
              return;
            }
          }
        } catch { /* not found, proceed */ }
      }
    }

    setError("");
    setLoading(true);

    const finalClient = cliente.trim();
    if (finalClient) {
      try {
        const stored = localStorage.getItem("clypfast_custom_clients");
        const currentList: string[] = stored ? JSON.parse(stored) : [];
        if (!currentList.includes(finalClient)) {
          const updated = [...currentList, finalClient];
          localStorage.setItem("clypfast_custom_clients", JSON.stringify(updated));
          setClientList((prev) => Array.from(new Set([...prev, finalClient])));
        }
      } catch {}
    }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanUrl,
          cliente: finalClient || undefined,
          content_type: contentType,
          transcription_engine: transcriptionEngine,
          whisper_model: whisperModel,
          max_clips: Number(maxClips),
          provider: provider,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Error iniciando el análisis");
      }

      const { job_id } = await res.json();
      router.push(`/analyze/${job_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setLoading(false);
    }
  }

  function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    triggerAnalysis(false);
  }

  return (
    <div className="page-wrapper">
      {/* Background orbs */}
      <div className="bg-orbs">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>

      {/* Top Navbar */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          {/* Logo */}
          <a href="/" className={styles.logoLink}>
            <Image
              src="/logo-clypfast.png"
              alt="ClypFast"
              width={140}
              height={32}
              className={styles.logoImg}
              priority
            />
          </a>

          {/* Nav Pills */}
          <nav className={styles.navPillContainer}>
            <a href="/" className={`${styles.navPill} ${styles.navPillActive}`}>
              Inicio
            </a>
            <a href="#analisis" className={styles.navPill}>
              Análisis
            </a>
            <a href="/history" className={styles.navPill}>
              Historial
            </a>
            <a href="#configuracion" className={styles.navPill}>
              Configuración
            </a>
          </nav>

          {/* User Profile Pill */}
          <div className={styles.userPill}>
            <div className={styles.userAvatar}>M</div>
            <span className={styles.userName}>Marcos</span>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </div>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className={styles.main}>
        <div className={styles.heroGrid}>
          {/* Left Column: Form & Features */}
          <div className={styles.leftCol}>
            {/* Top pill badge */}
            <div className={styles.badge}>
              USO PERSONAL · POWERED BY GROQ + FASTER-WHISPER
            </div>

            {/* Headline */}
            <h1 className={styles.heroTitle}>
              De videos largos<br />
              a <span className={styles.clipHighlight}>clips virales.</span>
              <span className={styles.cursor}>|</span>
            </h1>

            {/* Subtitle */}
            <p className={styles.heroSubtitle}>
              Pega un link de YouTube y en minutos obtén los mejores momentos
              con timestamps exactos, títulos sugeridos y clips listos para publicar.
            </p>

            {/* Main Interactive Form Card */}
            <form onSubmit={handleAnalyze} className={styles.formCard} id="analisis">
              {/* Input Row */}
              <div className={styles.inputRow}>
                <span className={styles.inputIcon}>
                  <Link2 size={16} strokeWidth={2} />
                </span>
                <input
                  type="url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (historyMatch) setHistoryMatch(null);
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted && isYouTubeUrl(pasted)) {
                      checkHistory(pasted);
                    }
                  }}
                  onBlur={(e) => checkHistory(e.target.value)}
                  className={styles.urlInput}
                  disabled={loading}
                  required
                  id="youtube-url-input"
                />
                <button
                  type="submit"
                  className={styles.analyzeBtn}
                  disabled={loading || !url.trim()}
                  id="analyze-btn"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Iniciando...</span>
                    </>
                  ) : checkingHistory ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Buscando...</span>
                    </>
                  ) : historyMatch ? (
                    <>
                      <ArrowRight size={14} strokeWidth={2.5} />
                      <span>Ver clips</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={14} strokeWidth={2.5} />
                      <span>Analizar</span>
                    </>
                  )}
                </button>
              </div>

              {/* Banner: URL ya procesada en el historial */}
              {historyMatch && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  borderRadius: "12px",
                  background: "rgba(34, 211, 238, 0.08)",
                  border: "1px solid rgba(34, 211, 238, 0.25)",
                  marginTop: 6,
                  flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 18 }}>🗂</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#22d3ee", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>Ya analizado</span>
                      {historyMatch.provider && (
                        <span style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: historyMatch.provider === "groq" ? "rgba(249, 115, 22, 0.2)" : "rgba(168, 85, 247, 0.2)",
                          color: historyMatch.provider === "groq" ? "#f97316" : "#c084fc",
                          border: `1px solid ${historyMatch.provider === "groq" ? "rgba(249, 115, 22, 0.3)" : "rgba(168, 85, 247, 0.3)"}`,
                          fontWeight: 800,
                        }}>
                          {historyMatch.provider === "groq" ? "⚡ Groq" : "✨ Gemini"}
                        </span>
                      )}
                      <span style={{ color: "#94a3b8", fontWeight: 500 }}>— {historyMatch.clips_count} clips</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {historyMatch.title}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => router.push(`/analyze/db/${historyMatch.id}`)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "7px",
                        background: "rgba(34, 211, 238, 0.9)",
                        border: "none",
                        color: "#001a22",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Ver clips guardados
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: "6px 12px",
                        borderRadius: "7px",
                        background: "linear-gradient(135deg, rgba(124, 58, 237, 0.8), rgba(6, 182, 212, 0.8))",
                        border: "none",
                        color: "#ffffff",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        whiteSpace: "nowrap",
                      }}
                      onClick={() => triggerAnalysis(true)}
                      disabled={loading}
                      title={`Crear un nuevo análisis independiente con ${provider.toUpperCase()}`}
                    >
                      <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
                      <span>Analizar con {provider.toUpperCase()} (Crear nuevo)</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedMatchUrl(url.trim());
                      setHistoryMatch(null);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="Descartar aviso para reconfigurar opciones"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* 2x2 Selectors Grid */}
              <div className={styles.selectorsRow}>
                {/* 1. Tipo de contenido (Enfoque IA) */}
                <div className={styles.selectBox}>
                  <div className={styles.selectHeader}>
                    <Sparkles size={12} strokeWidth={2} />
                    <span>Tipo de contenido (Enfoque IA)</span>
                  </div>
                  <select
                    className={styles.selectNative}
                    value={contentType}
                    onChange={(e) => {
                      const val = e.target.value;
                      setContentType(val);
                      try {
                        localStorage.setItem("clypfast_last_content_type", val);
                      } catch {}
                    }}
                    disabled={loading}
                    id="content-type-select"
                  >
                    <option value="vlog">Vlogs, Viajes y Restaurantes</option>
                    <option value="entrevista">Entrevistas y Podcasts</option>
                    <option value="politica">Política y Debate de Opinión</option>
                    <option value="streaming">Streaming, Gaming y Reacciones</option>
                    <option value="educativo">Educativo, Negocios y Charlas</option>
                    <option value="comedia">Comedia y Entretenimiento</option>
                    <option value="general">General / Mixto</option>
                  </select>
                  <span className={styles.chevronIcon}>
                    <ChevronDown size={13} strokeWidth={2} />
                  </span>
                </div>

                {/* 2. Clips a detectar */}
                <div className={styles.selectBox}>
                  <div className={styles.selectHeader}>
                    <Film size={12} strokeWidth={2} />
                    <span>Clips a detectar</span>
                  </div>
                  <select
                    className={styles.selectNative}
                    value={maxClips}
                    onChange={(e) => setMaxClips(e.target.value)}
                    disabled={loading}
                    id="clips-select"
                  >
                    <option value="5">5 clips virales</option>
                    <option value="8">8 clips virales</option>
                    <option value="12">12 clips (Recomendado)</option>
                    <option value="15">15 clips virales</option>
                    <option value="20">20 clips virales</option>
                  </select>
                  <span className={styles.chevronIcon}>
                    <ChevronDown size={13} strokeWidth={2} />
                  </span>
                </div>

                {/* 3. Motor de transcripción */}
                <div className={styles.selectBox}>
                  <div className={styles.selectHeader}>
                    <Zap size={12} strokeWidth={2} />
                    <span>Motor de transcripción</span>
                  </div>
                  <select
                    className={styles.selectNative}
                    value={transcriptionEngine}
                    onChange={(e) => setTranscriptionEngine(e.target.value)}
                    disabled={loading}
                    id="engine-select"
                  >
                    <option value="auto">Inteligente (Auto: Subs o Groq)</option>
                    <option value="groq">Groq Whisper Cloud (Ultra rápido)</option>
                    <option value="local">Whisper Local (Offline M3)</option>
                    <option value="youtube_subs">Subtítulos oficiales de YouTube</option>
                  </select>
                  <span className={styles.chevronIcon}>
                    <ChevronDown size={13} strokeWidth={2} />
                  </span>
                </div>

                {/* 4. Modelo de Análisis IA (LLM) */}
                <div className={styles.selectBox}>
                  <div className={styles.selectHeader}>
                    <Bot size={12} strokeWidth={2} />
                    <span>Modelo de Análisis IA</span>
                  </div>
                  <select
                    className={styles.selectNative}
                    value={provider}
                    onChange={(e) => {
                      const val = e.target.value as "groq" | "gemini";
                      setProvider(val);
                      try {
                        localStorage.setItem("clypfast_preferred_provider", val);
                      } catch {}
                    }}
                    disabled={loading}
                    id="provider-select"
                  >
                    <option value="groq">⚡ Groq (Llama / Compound - Recomendado)</option>
                    <option value="gemini">✨ Google Gemini (3.5 Flash)</option>
                  </select>
                  <span className={styles.chevronIcon}>
                    <ChevronDown size={13} strokeWidth={2} />
                  </span>
                </div>

                {/* 5. Cliente o Marca (Select o Registrar Nuevo) */}
                <div className={styles.selectBox} style={{ gridColumn: "1 / -1" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div className={styles.selectHeader}>
                      <Tag size={12} strokeWidth={2} />
                      <span>Cliente o Marca</span>
                    </div>
                    {clientList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingNewClient(!isCreatingNewClient);
                          if (isCreatingNewClient) setCliente("");
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: isCreatingNewClient ? "#94a3b8" : "#38bdf8",
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: "1px 4px",
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                        }}
                        title={isCreatingNewClient ? "Volver a seleccionar de la lista" : "Registrar nuevo cliente"}
                      >
                        {isCreatingNewClient ? "← Lista" : "+ Nuevo"}
                      </button>
                    )}
                  </div>

                  {isCreatingNewClient || clientList.length === 0 ? (
                    <input
                      type="text"
                      placeholder="Nombre del cliente o marca..."
                      value={cliente}
                      onChange={(e) => setCliente(e.target.value)}
                      disabled={loading}
                      className={styles.inputNative}
                      id="cliente-input"
                      autoFocus={isCreatingNewClient}
                    />
                  ) : (
                    <select
                      className={styles.selectNative}
                      value={cliente}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__NEW__") {
                          setIsCreatingNewClient(true);
                          setCliente("");
                        } else {
                          setCliente(val);
                        }
                      }}
                      disabled={loading}
                      id="cliente-select"
                    >
                      <option value="">Sin cliente (General)</option>
                      {clientList.map((c) => (
                        <option key={c} value={c}>
                          🏷️ {c}
                        </option>
                      ))}
                      <option value="__NEW__">➕ Registrar nuevo cliente...</option>
                    </select>
                  )}
                  {!isCreatingNewClient && clientList.length > 0 && (
                    <span className={styles.chevronIcon}>
                      <ChevronDown size={13} strokeWidth={2} />
                    </span>
                  )}
                </div>
              </div>

              {/* Sub-selector condicional si se usa Whisper Local */}
              {transcriptionEngine === "local" && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#94a3b8" }}>
                  <Server className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Modelo local:</span>
                  <select
                    value={whisperModel}
                    onChange={(e) => setWhisperModel(e.target.value)}
                    disabled={loading}
                    className={styles.selectNative}
                    style={{ maxWidth: 200, padding: "4px 8px", background: "rgba(255,255,255,0.05)", borderRadius: 6 }}
                  >
                    <option value="tiny">tiny (Ultra rápido)</option>
                    <option value="base">base (Ligero)</option>
                    <option value="small">small (Recomendado M3)</option>
                    <option value="medium">medium (Alta precisión)</option>
                  </select>
                </div>
              )}

              {/* Error Banner */}
              {error && (
                <div className={styles.errorBanner}>
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}
            </form>

            {/* 4 Feature Items */}
            <div className={styles.featuresGrid}>
              {/* Feature 1 */}
              <div className={styles.featureItem}>
                <div className={styles.featureIconWrap}>
                  <FileText className="h-5 w-5 text-cyan-400" />
                </div>
                <h4 className={styles.featureTitle}>Transcripción local</h4>
                <p className={styles.featureDesc}>faster-whisper en tu equipo</p>
              </div>

              {/* Feature 2 */}
              <div className={styles.featureItem}>
                <div className={styles.featureIconWrap}>
                  <Sparkles className="h-5 w-5 text-cyan-400" />
                </div>
                <h4 className={styles.featureTitle}>Análisis con IA</h4>
                <p className={styles.featureDesc}>Detecta los momentos más virales</p>
              </div>

              {/* Feature 3 */}
              <div className={styles.featureItem}>
                <div className={styles.featureIconWrap}>
                  <Play className="h-5 w-5 text-cyan-400" />
                </div>
                <h4 className={styles.featureTitle}>Preview en tiempo real</h4>
                <p className={styles.featureDesc}>Salta al momento exacto</p>
              </div>

              {/* Feature 4 */}
              <div className={styles.featureItem}>
                <div className={styles.featureIconWrap}>
                  <BarChart3 className="h-5 w-5 text-cyan-400" />
                </div>
                <h4 className={styles.featureTitle}>Score viral 1-10</h4>
                <p className={styles.featureDesc}>Cada clip recibe una puntuación</p>
              </div>
            </div>

            {/* Bottom privacy note */}
            <div className={styles.privacyNote}>
              <ShieldCheck className="h-4 w-4 text-neutral-400" />
              <span>Procesamiento local · Tu contenido no se almacena</span>
            </div>
          </div>

          {/* Right Column: Hero Visual Showcase */}
          <div className={styles.rightCol}>
            <div className={styles.showcaseWrapper}>
              <div className={styles.showcaseGlow} />
              <Image
                src="/hero-section.png"
                alt="ClipFinder Showcase"
                width={760}
                height={510}
                className={styles.heroImage}
                priority
              />
            </div>

            {/* Tagline footer underneath showcase */}
            <div className={styles.showcaseTagline}>
              <div className={styles.taglineTitle}>
                Convierte conversaciones en contenido que conecta
              </div>
              <div className={styles.taglineDivider} />
              <div className={styles.taglineDesc}>
                Ahorra horas de edición manual y enfócate en lo que importa: crear contenido con impacto.
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
