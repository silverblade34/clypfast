"use client";

import { useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pre-check historial: si la URL ya fue procesada
  const [historyMatch, setHistoryMatch] = useState<{ id: number; title: string; clips_count: number } | null>(null);
  const [checkingHistory, setCheckingHistory] = useState(false);

  const isYouTubeUrl = (u: string) => /youtube\.com|youtu\.be/.test(u);

  /** Busca en la DB si la URL ya fue analizada. Se llama al perder el foco del input. */
  async function checkHistory(inputUrl: string) {
    if (!inputUrl.trim() || !isYouTubeUrl(inputUrl)) {
      setHistoryMatch(null);
      return;
    }
    setCheckingHistory(true);
    try {
      const res = await fetch(`/api/videos/lookup?url=${encodeURIComponent(inputUrl.trim())}`);
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


  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    if (!isYouTubeUrl(url)) {
      setError("Por favor ingresa una URL válida de YouTube.");
      return;
    }

    // Si ya tenemos una coincidencia en el historial, redirigir directo
    if (historyMatch) {
      router.push(`/analyze/db/${historyMatch.id}`);
      return;
    }

    setError("");
    setLoading(true);

    // Re-verificar por si el usuario no hizo blur
    try {
      const lookupRes = await fetch(`/api/videos/lookup?url=${encodeURIComponent(url.trim())}`);
      if (lookupRes.ok) {
        const existing = await lookupRes.json();
        router.push(`/analyze/db/${existing.id}`);
        return;
      }
    } catch { /* not found, proceed with new analysis */ }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          cliente: cliente.trim() || undefined,
          content_type: contentType,
          transcription_engine: transcriptionEngine,
          whisper_model: whisperModel,
          max_clips: Number(maxClips),
          provider: "groq",
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
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: "rgba(34, 211, 238, 0.07)",
                  border: "1px solid rgba(34, 211, 238, 0.2)",
                  marginTop: 4,
                  flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 16 }}>🗂</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#22d3ee" }}>
                      Video ya analizado — {historyMatch.clips_count} clips guardados
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {historyMatch.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/analyze/db/${historyMatch.id}`)}
                    style={{
                      padding: "5px 12px",
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
                    type="submit"
                    style={{
                      padding: "5px 10px",
                      borderRadius: "7px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "#64748b",
                      fontSize: 11,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    onClick={() => setHistoryMatch(null)}
                  >
                    Re-analizar
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
                    onChange={(e) => setContentType(e.target.value)}
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

                {/* 4. Cliente o Marca (Opcional) */}
                <div className={styles.selectBox}>
                  <div className={styles.selectHeader}>
                    <Tag size={12} strokeWidth={2} />
                    <span>Cliente o Marca (Opcional)</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Nombre de cliente o proyecto..."
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    disabled={loading}
                    className={styles.inputNative}
                    id="cliente-input"
                  />
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
