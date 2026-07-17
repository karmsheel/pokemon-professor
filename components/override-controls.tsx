"use client";

import { useCallback, useEffect, useState } from "react";

type ControlMode = "agent" | "nudge" | "drive";

type OverrideControlsProps = {
  mode: ControlMode;
  onModeChange: (mode: ControlMode) => void;
  disabled?: boolean;
};

const KEY_MAP: Record<string, string> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  z: "A",
  Z: "A",
  x: "B",
  X: "B",
  Enter: "START",
  Shift: "SELECT",
};

export function OverrideControls({
  mode,
  onModeChange,
  disabled,
}: OverrideControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<string | null>(null);

  const setMode = useCallback(
    async (next: ControlMode) => {
      if (!window.studio) {
        setError("window.studio unavailable (open via Electron)");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const applied = (await window.studio.setMode(next)) as ControlMode;
        onModeChange(applied);
      } catch (e) {
        setError(e instanceof Error ? e.message : "setMode failed");
      } finally {
        setBusy(false);
      }
    },
    [onModeChange]
  );

  useEffect(() => {
    if (mode !== "drive") return;

    const onKeyDown = (ev: KeyboardEvent) => {
      const button = KEY_MAP[ev.key];
      if (!button) return;
      // Avoid scrolling / default browser behavior for arrows.
      if (ev.key.startsWith("Arrow") || ev.key === " ") {
        ev.preventDefault();
      }
      if (!window.studio?.driveInput) {
        setError("driveInput IPC missing");
        return;
      }
      void window.studio
        .driveInput([button])
        .then(() => {
          setLastInput(button);
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "driveInput failed");
        });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  return (
    <section className="panel">
      <h2>Override</h2>
      <div className="stack">
        <div className="row">
          <button
            type="button"
            className={mode === "nudge" ? "active" : undefined}
            disabled={disabled || busy}
            onClick={() => void setMode("nudge")}
          >
            Nudge
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className={mode === "drive" ? "active" : undefined}
            disabled={disabled || busy}
            onClick={() => void setMode("drive")}
          >
            Drive
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className={mode === "agent" ? "active primary" : "primary"}
            disabled={disabled || busy}
            onClick={() => void setMode("agent")}
          >
            Resume Agent
          </button>
        </div>

        <div className="status-pill ok">
          <span className="dot" />
          mode: {mode}
        </div>

        {mode === "drive" ? (
          <p className="muted">
            Keys: arrows move · Z = A · X = B · Enter = START · Shift = SELECT.
            Input uses IPC <code>driveInput</code> (not POST /input).
          </p>
        ) : (
          <p className="muted">
            Nudge pauses agent control. Drive enables local keys via IPC.
          </p>
        )}

        {lastInput && mode === "drive" ? (
          <p className="muted">last input: {lastInput}</p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  );
}
