"use client";

import { useEffect, useRef, useState } from "react";
import { fetchFrame } from "@/lib/control-client";

type ControlMode = "agent" | "nudge" | "drive";

type LiveViewProps = {
  controlUrl: string | null;
  mode?: ControlMode;
};

export function LiveView({ controlUrl, mode = "agent" }: LiveViewProps) {
  const [data, setData] = useState<string | null>(null);
  const [frameId, setFrameId] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  // Drive: keep keyboard focus on the live view so chat cannot steal game keys.
  useEffect(() => {
    if (mode !== "drive") return;
    const el = panelRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    if (!controlUrl) {
      setData(null);
      setFrameId(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const frame = await fetchFrame(controlUrl);
        if (cancelled) return;
        setData(frame.data);
        setFrameId(frame.frame_id);
        setSize({ w: frame.width, h: frame.height });
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "frame poll failed");
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, 250);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [controlUrl]);

  const driveActive = mode === "drive";

  const nativeW = size?.w ?? 240;
  const nativeH = size?.h ?? 160;

  return (
    <section
      ref={panelRef}
      className={`panel live-view${driveActive ? " live-view-drive" : ""}${
        driveActive && focused ? " live-view-drive-focused" : ""
      }`}
      tabIndex={driveActive ? 0 : -1}
      role="application"
      aria-label={driveActive ? "Live view (drive mode — keyboard control)" : "Live view"}
      data-testid="live-view"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={() => {
        if (driveActive) {
          panelRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <h2>Live view{driveActive ? " · DRIVE" : ""}</h2>
      <div className="live-frame-viewport">
        {data ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="live-frame"
            alt="Emulator frame — live FireRed / GBA screen"
            src={`data:image/png;base64,${data}`}
            /* Native GBA size is only metadata — CSS scales the display */
            width={nativeW}
            height={nativeH}
            draggable={false}
          />
        ) : (
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
        )}
      </div>
      <div className="live-meta">
        <span>frame_id: {frameId ?? "—"}</span>
        <span>
          native: {size ? `${size.w}×${size.h}` : "—"} (scaled to fit)
        </span>
        {driveActive ? (
          <span className="ok-text">
            {focused ? "keys armed" : "click to focus keys"}
          </span>
        ) : null}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </section>
  );
}
