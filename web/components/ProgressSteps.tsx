"use client";

import { Check } from "lucide-react";
import styles from "./ProgressSteps.module.css";

export interface PipelineStepDef {
  key: string;
  stepNumber: number;
  label: string;
  defaultDesc: string;
  defaultTime: string;
  activeWhen: string[];
  doneWhen: string[];
}

export const PIPELINE_STEPS: PipelineStepDef[] = [
  {
    key: "video_loaded",
    stepNumber: 1,
    label: "Video cargado",
    defaultDesc: "Verificando enlace y origen de video",
    defaultTime: "00:03",
    activeWhen: [],
    doneWhen: [
      "starting",
      "subtitles",
      "download",
      "download_done",
      "transcribe",
      "transcribe_done",
      "analyze",
      "analyze_done",
      "saving",
      "done",
    ],
  },
  {
    key: "download",
    stepNumber: 2,
    label: "Descarga de audio",
    defaultDesc: "Extrayendo pista de audio (16kHz mono)",
    defaultTime: "00:21",
    activeWhen: ["download"],
    doneWhen: [
      "download_done",
      "transcribe",
      "transcribe_done",
      "analyze",
      "analyze_done",
      "saving",
      "done",
    ],
  },
  {
    key: "transcribe",
    stepNumber: 3,
    label: "Transcripción con IA",
    defaultDesc: "Convirtiendo audio en texto con timestamps...",
    defaultTime: "~ 1 min",
    activeWhen: ["transcribe", "subtitles"],
    doneWhen: [
      "transcribe_done",
      "analyze",
      "analyze_done",
      "saving",
      "done",
    ],
  },
  {
    key: "analyze",
    stepNumber: 4,
    label: "Análisis de contenido",
    defaultDesc: "Detectando temas, hooks y momentos clave",
    defaultTime: "--:--",
    activeWhen: ["analyze"],
    doneWhen: [
      "analyze_done",
      "saving",
      "done",
    ],
  },
  {
    key: "clips",
    stepNumber: 5,
    label: "Generación de clips",
    defaultDesc: "Creando los mejores momentos",
    defaultTime: "--:--",
    activeWhen: ["analyze_done"],
    doneWhen: [
      "saving",
      "done",
    ],
  },
  {
    key: "saving",
    stepNumber: 6,
    label: "Finalizando",
    defaultDesc: "Preparando tu reporte",
    defaultTime: "--:--",
    activeWhen: ["saving"],
    doneWhen: ["done"],
  },
];

type StepState = "pending" | "active" | "done";

function getStepState(step: PipelineStepDef, currentStep: string): StepState {
  if (step.doneWhen.includes(currentStep)) return "done";
  if (step.activeWhen.includes(currentStep)) return "active";
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
  chunkTimeRange?: string;
  clipsFoundSoFar?: number;
  downloadPct?: number;
  downloadSpeed?: string;
  transcribePct?: number;
  transcribeSegs?: number;
  transcriptionMethodUsed?: "youtube_subs" | "groq" | "local" | null;
  videoUrl?: string;
}

export default function ProgressSteps({
  currentStep,
  progress,
  segments,
  duration,
  chunkCurrent = 1,
  chunkTotal = 1,
  chunkTimeRange = "",
  clipsFoundSoFar = 0,
  downloadPct = 0,
  downloadSpeed = "",
  transcribePct = 0,
  transcribeSegs = 0,
  transcriptionMethodUsed = null,
  videoUrl = "",
}: Props) {
  return (
    <div className={styles.wrapper}>
      {/* Steps List */}
      <div className={styles.steps}>
        {PIPELINE_STEPS.map((step, i) => {
          const state = getStepState(step, currentStep);
          const isDownload = step.key === "download";
          const isTranscribe = step.key === "transcribe";
          const isAnalyze = step.key === "analyze";
          const isClips = step.key === "clips";

          // Calculate display text & time badge
          let stepSubtitle = step.defaultDesc;
          let timeBadge = step.defaultTime;

          if (step.key === "video_loaded" && videoUrl) {
            stepSubtitle = videoUrl.length > 38 ? videoUrl.slice(0, 38) + "..." : videoUrl;
            timeBadge = "00:03";
          }

          if (isDownload) {
            if (state === "done") {
              if (transcriptionMethodUsed === "youtube_subs") {
                stepSubtitle = "Subtítulos directos de YouTube (sin descarga)";
                timeBadge = "00:01";
              } else {
                stepSubtitle = "Pista de audio 16kHz mono extraída";
                timeBadge = "00:21";
              }
            } else if (state === "active") {
              stepSubtitle = `Descargando audio... ${downloadPct}% ${downloadSpeed ? `(${downloadSpeed})` : ""}`;
            }
          }

          if (isTranscribe) {
            if (state === "done") {
              if (transcriptionMethodUsed === "youtube_subs") {
                stepSubtitle = `Subtítulos oficiales de YouTube (${segments ?? 0} segmentos)`;
                timeBadge = "00:01";
              } else if (transcriptionMethodUsed === "groq") {
                stepSubtitle = `Groq Whisper Cloud (${segments ?? 0} segmentos)`;
                timeBadge = "00:06";
              } else {
                stepSubtitle = `Whisper local M3 Pro (${segments ?? 0} segmentos)`;
                timeBadge = "00:45";
              }
            } else if (state === "active") {
              stepSubtitle = "Convirtiendo audio en texto...";
              timeBadge = "~ 1 min";
            }
          }

          if (isAnalyze) {
            if (state === "active") {
              stepSubtitle = chunkTimeRange
                ? `Analizando sección ${chunkTimeRange} (Bloque ${chunkCurrent} de ${chunkTotal})`
                : `Evaluando hooks y retención... Bloque ${chunkCurrent} de ${chunkTotal}`;
              timeBadge = `Bloque ${chunkCurrent}/${chunkTotal}`;
            } else if (state === "done") {
              stepSubtitle = "Temas, hooks y momentos clave evaluados";
              timeBadge = "Listo";
            }
          }

          if (isClips) {
            if (state === "active" || (currentStep === "analyze" && clipsFoundSoFar > 0)) {
              stepSubtitle = `${clipsFoundSoFar} clips detectados hasta el momento`;
              timeBadge = `${clipsFoundSoFar} clips`;
            } else if (state === "done") {
              stepSubtitle = `${clipsFoundSoFar > 0 ? clipsFoundSoFar : "Mejores"} momentos virales detectados`;
              timeBadge = `${clipsFoundSoFar} clips`;
            }
          }

          return (
            <div
              key={step.key}
              className={`${styles.stepRow} ${styles[state]} ${state === "active" ? styles.stepRowActive : ""}`}
            >
              {/* Left Column: Number/Checkmark Circle + Vertical Line */}
              <div className={styles.stepLeft}>
                <div className={styles.circleBadge}>
                  {state === "done" ? (
                    <Check size={14} className={styles.checkIcon} strokeWidth={3} />
                  ) : (
                    <span className={styles.stepNum}>{step.stepNumber}</span>
                  )}
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <div
                    className={`${styles.connectorLine} ${
                      state === "done" ? styles.connectorDone : ""
                    }`}
                  />
                )}
              </div>

              {/* Middle Column: Title & Subtitle */}
              <div className={styles.stepCenter}>
                <div className={styles.stepTitleRow}>
                  <p className={styles.stepLabel}>{step.label}</p>
                </div>
                <p className={styles.stepSub}>{stepSubtitle}</p>

                {/* Granular Active Sub-bar for Download */}
                {state === "active" && isDownload && downloadPct > 0 && (
                  <div className={styles.subBarTrack}>
                    <div
                      className={styles.subBarFill}
                      style={{ width: `${Math.max(downloadPct, 5)}%` }}
                    />
                  </div>
                )}

                {/* Granular Active Sub-bar for Transcribe */}
                {state === "active" && isTranscribe && transcribePct > 0 && (
                  <div className={styles.subBarTrack}>
                    <div
                      className={styles.subBarFill}
                      style={{ width: `${Math.max(transcribePct, 5)}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Right Column: Time badge or Soundwave */}
              <div className={styles.stepRight}>
                {state === "active" && isTranscribe ? (
                  <div className={styles.soundWaveGroup}>
                    <div className={styles.soundWave}>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className={styles.timeBadge}>{timeBadge}</span>
                  </div>
                ) : (
                  <span
                    className={`${styles.timeBadge} ${
                      state === "active" ? styles.timeBadgeActive : ""
                    }`}
                  >
                    {timeBadge}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
