"use client";

import { useEffect, useRef, useState } from "react";
import { fetchFrameBlob } from "@/lib/control-client";

type ControlMode = "agent" | "nudge" | "drive";

type LiveViewProps = {
  controlUrl: string | null;
  mode?: ControlMode;
};

/**
 * Safety floor between poll starts after a fetch completes.
 * Actual rate is backpressure-limited: wait for previous fetch + this gap.
 * Capture is owned by the shared Control API buffer — no mode throttle.
 */
const MIN_POLL_GAP_MS = 16;

/** Only surface stream errors after several consecutive failures (avoids flash). */
const ERROR_STREAK_SHOW = 3;

export function LiveView({ controlUrl, mode = "agent" }: LiveViewProps) {
  const [fps, setFps] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [focused, setFocused] = useState(false);
  /** Age of the last painted frame from x-captured-at (ms), if known. */
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const lastFrameIdRef = useRef<number | null>(null);
  /** Timestamps (ms) of painted frames for a rolling 1s FPS window. */
  const paintTimesRef = useRef<number[]>([]);
  const failStreakRef = useRef(0);
  const lastFpsUiRef = useRef(0);
  /** Latest captured_at from the stream (for age meta). */
  const lastCapturedAtRef = useRef<number | null>(null);

  // Drive: keep keyboard focus on the live view so chat cannot steal game keys.
  useEffect(() => {
    if (mode !== "drive") return;
    const el = panelRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
  }, [mode]);

  // Tear down blob URL on unmount.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Stream poll: max backpressure (wait for previous fetch + min gap). Mode is UI-only.
  useEffect(() => {
    if (!controlUrl) {
      lastFrameIdRef.current = null;
      lastCapturedAtRef.current = null;
      paintTimesRef.current = [];
      failStreakRef.current = 0;
      setFps(null);
      setSize(null);
      setError(null);
      setHasFrame(false);
      setAgeMs(null);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (imgRef.current) imgRef.current.removeAttribute("src");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    paintTimesRef.current = [];
    failStreakRef.current = 0;
    setFps(null);

    /** Drop paints older than 1s; optionally record a new paint. Throttle UI. */
    const updateFps = (painted: boolean) => {
      const now = performance.now();
      const times = paintTimesRef.current;
      if (painted) times.push(now);
      const cutoff = now - 1000;
      while (times.length > 0 && times[0]! < cutoff) {
        times.shift();
      }
      // Throttle React FPS updates to ~4Hz so meta text doesn't thrash layout.
      if (now - lastFpsUiRef.current >= 250) {
        lastFpsUiRef.current = now;
        setFps(times.length > 0 ? times.length : null);
        const cap = lastCapturedAtRef.current;
        setAgeMs(cap != null ? Math.max(0, Date.now() - cap) : null);
      }
    };

    /**
     * Swap image only after the browser successfully decodes the new blob.
     * Keeps the last good frame on screen (no blank/zoom flicker on bad frames).
     */
    const applyFrame = (frame: {
      blob: Blob;
      width: number;
      height: number;
      frame_id: number;
      captured_at: number | null;
    }) => {
      if (frame.captured_at != null) {
        lastCapturedAtRef.current = frame.captured_at;
      }

      if (
        lastFrameIdRef.current !== null &&
        frame.frame_id === lastFrameIdRef.current
      ) {
        // Same buffer frame — skip paint but still refresh age/FPS window.
        updateFps(false);
        return;
      }

      const img = imgRef.current;
      if (!img) return;

      const nextUrl = URL.createObjectURL(frame.blob);
      const prevUrl = blobUrlRef.current;

      const cleanupListeners = () => {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      };

      const onLoad = () => {
        cleanupListeners();
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        lastFrameIdRef.current = frame.frame_id;
        blobUrlRef.current = nextUrl;
        if (prevUrl && prevUrl !== nextUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        failStreakRef.current = 0;
        setHasFrame(true);
        setSize((s) =>
          s && s.w === frame.width && s.h === frame.height
            ? s
            : { w: frame.width, h: frame.height }
        );
        setError(null);
        updateFps(true);
      };

      const onError = () => {
        cleanupListeners();
        URL.revokeObjectURL(nextUrl);
        // Keep previous frame painted — do not clear src.
        if (!cancelled) {
          failStreakRef.current += 1;
          if (failStreakRef.current >= ERROR_STREAK_SHOW) {
            setError("bad frame data (kept last good)");
          }
          updateFps(false);
        }
      };

      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
      img.src = nextUrl;
    };

    const poll = async () => {
      if (cancelled) return;
      const t0 = performance.now();
      try {
        const frame = await fetchFrameBlob(controlUrl);
        if (cancelled) return;
        applyFrame(frame);
      } catch (e) {
        if (!cancelled) {
          // Soft-fail when no frame is ready yet (404 / empty buffer).
          const msg = e instanceof Error ? e.message : "frame poll failed";
          const soft =
            /404|not ready|no frame|empty|rom not loaded/i.test(msg);
          if (!soft) {
            failStreakRef.current += 1;
            if (failStreakRef.current >= ERROR_STREAK_SHOW) {
              setError(msg);
            }
          }
          // Age the window so FPS falls when captures fail; keep last image.
          updateFps(false);
        }
      } finally {
        if (cancelled) return;
        const elapsed = performance.now() - t0;
        const wait = Math.max(0, MIN_POLL_GAP_MS - elapsed);
        timer = setTimeout(() => void poll(), wait);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [controlUrl]);

  const driveActive = mode === "drive";

  return (
    <section
      ref={panelRef}
      className={`panel live-view${driveActive ? " live-view-drive" : ""}${
        driveActive && focused ? " live-view-drive-focused" : ""
      }`}
      tabIndex={driveActive ? 0 : -1}
      role="application"
      aria-label={
        driveActive ? "Live view (drive mode — keyboard control)" : "Live view"
      }
      data-testid="live-view"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={() => {
        if (driveActive) {
          panelRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div className="live-view-header">
        <h2>Live view{driveActive ? " · DRIVE" : ""}</h2>
        {error ? (
          <span className="live-view-error" role="status" title={error}>
            {error}
          </span>
        ) : null}
      </div>
      <div className="live-frame-viewport">
        {/*
          Always mount <img>; src swaps via blob URL only after load success.
          Absolute positioning keeps layout stable (no zoom/focus pulse).
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          className="live-frame"
          alt="Emulator frame — live FireRed / GBA screen"
          draggable={false}
          hidden={!hasFrame}
        />
        {!hasFrame ? (
          <div className="live-frame-placeholder">
            <span className="muted" style={{ textAlign: "center", lineHeight: 1.5 }}>
              {controlUrl ? (
                <>
                  Waiting for frames from Control API…
                  <br />
                  <small>
                    Start Run or Attach bridge (Run rail). If using mGBA, load{" "}
                    <code>mgba-bridge.lua</code> first.
                  </small>
                </>
              ) : (
                "Connecting to studio…"
              )}
            </span>
          </div>
        ) : null}
      </div>
      <div className="live-meta">
        <span title="Painted frames in the last second">
          fps: {fps != null ? fps : "—"}
        </span>
        <span>
          native: {size ? `${size.w}×${size.h}` : "—"} (scaled to fit)
        </span>
        <span className="muted" title="Max backpressure poll (shared frame buffer)">
          stream: max
        </span>
        {ageMs != null ? (
          <span className="muted" title="Age of buffer frame (x-captured-at)">
            age: {ageMs}ms
          </span>
        ) : null}
        {driveActive ? (
          <span className="ok-text">
            {focused ? "keys armed" : "click to focus keys"}
          </span>
        ) : null}
      </div>
    </section>
  );
}
