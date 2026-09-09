"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (e: { target: YouTubePlayerInstance }) => void;
            onStateChange?: (e: { data: number }) => void;
            onError?: (e: { data: number }) => void;
          };
        }
      ) => YouTubePlayerInstance;
      PlayerState?: { PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayerInstance {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
  getCurrentTime?: () => number;
}

export interface YouTubePlayerRef {
  seekTo: (seconds: number) => void;
}

interface Props {
  videoId: string;
  className?: string;
}

const YouTubePlayer = forwardRef<YouTubePlayerRef, Props>(
  ({ videoId, className }, ref) => {
    const rawId = useId();
    // Unique DOM-safe ID for the iframe container
    const playerId = useRef(`yt-frame-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`);
    const playerInstanceRef = useRef<YouTubePlayerInstance | null>(null);
    const isReadyRef = useRef(false);
    const pendingSeekRef = useRef<number | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const player = playerInstanceRef.current;
        if (
          isReadyRef.current &&
          player &&
          typeof player.seekTo === "function"
        ) {
          try {
            player.seekTo(seconds, true);
            if (typeof player.playVideo === "function") {
              player.playVideo();
            }
          } catch (err) {
            console.warn("Error seeking YouTube player:", err);
          }
        } else {
          // Player not yet ready — queue seek so it executes onReady
          pendingSeekRef.current = seconds;
        }
      },
    }));

    useEffect(() => {
      let isCancelled = false;
      isReadyRef.current = false;

      function createPlayer() {
        if (isCancelled) return;
        const domEl = document.getElementById(playerId.current);
        if (!domEl) return;

        try {
          if (playerInstanceRef.current) {
            try {
              playerInstanceRef.current.destroy();
            } catch {
              // ignore cleanup error
            }
            playerInstanceRef.current = null;
          }

          playerInstanceRef.current = new window.YT!.Player(playerId.current, {
            videoId,
            playerVars: {
              autoplay: 0,
              rel: 0,
              modestbranding: 1,
              enablejsapi: 1,
              iv_load_policy: 3,
            },
            events: {
              onReady: (e) => {
                if (isCancelled) return;
                isReadyRef.current = true;
                setIsLoaded(true);

                // Execute any queued seek
                if (pendingSeekRef.current !== null) {
                  try {
                    e.target.seekTo(pendingSeekRef.current, true);
                    if (typeof e.target.playVideo === "function") {
                      e.target.playVideo();
                    }
                  } catch (err) {
                    console.warn("Failed executing pending seek:", err);
                  }
                  pendingSeekRef.current = null;
                }
              },
              onError: (err) => {
                console.warn("YouTube player error event:", err);
              },
            },
          });
        } catch (err) {
          console.error("Failed to instantiate YT.Player:", err);
        }
      }

      // Check if YouTube Iframe API script is already on page
      if (window.YT && window.YT.Player) {
        createPlayer();
      } else {
        const existingScript = document.getElementById("yt-iframe-api");
        if (!existingScript) {
          const tag = document.createElement("script");
          tag.id = "yt-iframe-api";
          tag.src = "https://www.youtube.com/iframe_api";
          document.head.appendChild(tag);
        }

        // Handle onYouTubeIframeAPIReady callback
        const prevOnReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof prevOnReady === "function") {
            try {
              prevOnReady();
            } catch {}
          }
          if (!isCancelled) {
            createPlayer();
          }
        };

        // Fallback polling in case the script loaded before the callback was attached
        const pollInterval = setInterval(() => {
          if (window.YT && window.YT.Player) {
            clearInterval(pollInterval);
            if (!isCancelled && !playerInstanceRef.current) {
              createPlayer();
            }
          }
        }, 150);

        // Safety timeout to stop polling after 10s
        const timeout = setTimeout(() => clearInterval(pollInterval), 10000);

        return () => {
          isCancelled = true;
          clearInterval(pollInterval);
          clearTimeout(timeout);
          if (playerInstanceRef.current) {
            try {
              playerInstanceRef.current.destroy();
            } catch {}
            playerInstanceRef.current = null;
          }
        };
      }

      return () => {
        isCancelled = true;
        if (playerInstanceRef.current) {
          try {
            playerInstanceRef.current.destroy();
          } catch {}
          playerInstanceRef.current = null;
        }
      };
    }, [videoId]);

    return (
      <div
        className={className}
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: "12px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          id={playerId.current}
          style={{ width: "100%", height: "100%" }}
        />
        {!isLoaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#05050d",
            }}
          >
            <span className="spinner" />
          </div>
        )}
      </div>
    );
  }
);

YouTubePlayer.displayName = "YouTubePlayer";
export default YouTubePlayer;
