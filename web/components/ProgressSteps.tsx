"use client";

import styles from "./ProgressSteps.module.css";

export interface Step {
  key: string;
  label: string;
  icon: string;
  doneWhen: string[];
}

export const PIPELINE_STEPS: Step[] = [
  {
    key: "download",
    label: "Descarga de audio",
    icon: "📥",
    doneWhen: ["download_done", "transcribe", "transcribe_done", "analyze", "analyze_done", "saving", "done"],
  },
  {
    key: "transcribe",
    label: "Transcripción con Whisper",
    icon: "🎙️",
    doneWhen: ["transcribe_done", "analyze", "analyze_done", "saving", "done"],
  },
  {
    key: "analyze",
    label: "Detección de momentos virales (IA)",
    icon: "🧠",
    doneWhen: ["analyze_done", "saving", "done"],
  },
  {
    key: "saving",
    label: "Generando reporte de clips",
    icon: "📊",
    doneWhen: ["done"],
  },
];

type StepState = "pending" | "active" | "done";

function getStepState(step: Step, currentStep: string): StepState {
  if (step.doneWhen.includes(currentStep)) return "done";
  if (
    step.key === currentStep ||
    (step.key === "download" && currentStep === "starting") ||
    (step.key === "transcribe" && currentStep === "transcribe") ||
    (step.key === "analyze" && currentStep === "analyze") ||
    (step.key === "saving" && currentStep === "saving")
  ) {
    return "active";
  }
  return "pending";
}

interface Props {
  currentStep: string;
  stepLabel: string;
  progress: number;
  segments?: number;
  duration?: number;
  chunkCurrent?: number;
  chunkTotal?: number;
  downloadPct?: number;
  downloadSpeed?: string;
  transcribePct?: number;
  transcribeSegs?: number;
  transcriptionMethodUsed?: "youtube_subs" | "groq" | "local" | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ProgressSteps({
  currentStep,
  stepLabel,
  progress,
  segments,
  duration,
  chunkCurrent,
  chunkTotal,
  downloadPct = 0,
  downloadSpeed = "",
  transcribePct = 0,
  transcribeSegs = 0,
  transcriptionMethodUsed = null,
}: Props) {
  return (
    <div className={styles.wrapper}>
      {/* Overall Progress bar */}
      <div className={styles.progressSection}>
        <div className={styles.progressHeader}>
          <div className={styles.progressLabelGroup}>
            <span className={styles.pulseDot} />
            <span className={styles.progressLabel}>{stepLabel}</span>
          </div>
          <span className={styles.progressPct}>{progress}%</span>
        </div>
        <div className="progress-bar-track">
          <div
            className={`progress-bar-fill ${styles.animatedFill}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps with granular real-time feedback */}
      <div className={styles.steps}>
        {PIPELINE_STEPS.map((step, i) => {
          const state = getStepState(step, currentStep);
          const isDownload = step.key === "download";
          const isTranscribe = step.key === "transcribe";
          const isAnalyze = step.key === "analyze";

          return (
            <div key={step.key} className={`${styles.step} ${styles[state]}`}>
              <div className={styles.stepLeft}>
                <div className={styles.stepIconWrapper}>
                  {state === "done" ? (
                    <span className={styles.stepCheckmark}>✓</span>
                  ) : state === "active" ? (
                    <span className="spinner" />
                  ) : (
                    <span className={styles.stepNumber}>{i + 1}</span>
                  )}
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div
                    className={`${styles.stepConnector} ${
                      state === "done" ? styles.connectorDone : ""
                    }`}
                  />
                )}
              </div>

              <div className={styles.stepContent}>
                <span className={styles.stepIcon}>{step.icon}</span>
                <div className={styles.stepDetails}>
                  <div className={styles.stepTitleRow}>
                    <p className={styles.stepLabel}>{step.label}</p>
                    {state === "active" && (
                      <span className={styles.liveBadge}>EN PROGRESO</span>
                    )}
                  </div>

                  {/* Active Step: Download Granular Progress */}
                  {state === "active" && isDownload && (
                    <div className={styles.subProgressBox}>
                      <div className={styles.subProgressHeader}>
                        <span>Descargando audio...</span>
                        <span className={styles.subProgressValue}>
                          {downloadPct}% {downloadSpeed && `(${downloadSpeed})`}
                        </span>
                      </div>
                      <div className={styles.subTrack}>
                        <div
                          className={styles.subFillDownload}
                          style={{ width: `${Math.max(downloadPct, 5)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Active Step: Transcribe Granular Progress & Waveform */}
                  {state === "active" && isTranscribe && (
                    <div className={styles.subProgressBox}>
                      <div className={styles.subProgressHeader}>
                        <span>Procesando audio localmente...</span>
                        <span className={styles.subProgressValue}>
                          {transcribePct}%
                        </span>
                      </div>
                      <div className={styles.subTrack}>
                        <div
                          className={styles.subFillTranscribe}
                          style={{ width: `${Math.max(transcribePct, 4)}%` }}
                        />
                      </div>
                      <div className={styles.transcribeInfoRow}>
                        <span className={styles.segmentCounter}>
                          🎙️ {transcribeSegs > 0 ? `${transcribeSegs} segmentos extraídos` : "Analizando ondas de voz..."}
                        </span>
                        {/* Audio equalizer animation */}
                        <div className={styles.soundWave}>
                          <span />
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Active Step: Analyze Granular Progress */}
                  {state === "active" && isAnalyze && (
                    <div className={styles.subProgressBox}>
                      <div className={styles.subProgressHeader}>
                        <span>Evaluando hooks y retención...</span>
                        {chunkTotal !== undefined && chunkTotal > 1 && (
                          <span className={styles.subProgressValue}>
                            Bloque {chunkCurrent} de {chunkTotal}
                          </span>
                        )}
                      </div>
                      {chunkTotal !== undefined && chunkTotal > 1 && (
                        <div className={styles.subTrack}>
                          <div
                            className={styles.subFillAnalyze}
                            style={{
                              width: `${Math.round(((chunkCurrent ?? 1) / chunkTotal) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Done State metadata */}
                  {state === "done" && isDownload && (
                    <p className={styles.stepMeta}>
                      {transcriptionMethodUsed === "youtube_subs"
                        ? "✓ Omitido: No requiere descarga de audio (subtítulos directos)"
                        : duration != null && duration > 0
                        ? `✓ Audio 16kHz mono extraído (${formatDuration(duration)})`
                        : "✓ Audio extraído"}
                    </p>
                  )}
                  {state === "done" && isTranscribe && (
                    <p className={styles.stepMeta}>
                      {transcriptionMethodUsed === "youtube_subs"
                        ? `✓ Subtítulos oficiales de YouTube (instantáneo 1s, ${segments ?? 0} segmentos)`
                        : transcriptionMethodUsed === "groq"
                        ? `✓ Groq Whisper Cloud Large-v3 (~15s, ${segments ?? 0} segmentos)`
                        : transcriptionMethodUsed === "local"
                        ? `✓ Whisper local M3 Pro (${segments ?? 0} segmentos)`
                        : `✓ ${segments ?? 0} segmentos de texto con timestamps listos`}
                    </p>
                  )}
                  {state === "done" && isAnalyze && (
                    <p className={styles.stepMeta}>
                      ✓ Momentos candidatos detectados y calificados
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
