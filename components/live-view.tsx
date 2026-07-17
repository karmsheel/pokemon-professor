"use client";

import { useEffect, useState } from "react";
import { fetchFrame } from "@/lib/control-client";

type LiveViewProps = {
  controlUrl: string | null;
};

export function LiveView({ controlUrl }: LiveViewProps) {
  const [data, setData] = useState<string | null>(null);
  const [frameId, setFrameId] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="panel live-view">
      <h2>Live view</h2>
      {data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="live-frame"
          alt="Emulator frame"
          src={`data:image/png;base64,${data}`}
          width={size?.w ?? 240}
          height={size?.h ?? 160}
        />
      ) : (
        <div className="live-frame" style={{ display: "grid", placeItems: "center" }}>
          <span className="muted">
            {controlUrl ? "Waiting for frame…" : "Start a run to see frames"}
          </span>
        </div>
      )}
      <div className="live-meta">
        <span>frame_id: {frameId ?? "—"}</span>
        <span>
          size: {size ? `${size.w}×${size.h}` : "—"}
        </span>
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </section>
  );
}
