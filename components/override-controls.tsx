"use client";

import { useCallback, useEffect, useState } from "react";
import type { ControlMode } from "@/electron/control-api/types";
import { resolveDriveKey } from "@/lib/drive-keys";

type OverrideControlsProps = {
  mode: ControlMode;
  onModeChange: (mode: ControlMode) => void;
  disabled?: boolean;
};

/** Drive keymap: Arrow keys, Z/X, Enter, Shift → GBA buttons. */
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

function modePillClass(mode: ControlMode): string {
  if (mode === "agent") return "status-pill ok";
  if (mode === "nudge") return "status-pill warn";
  return "status-pill warn";
}

function modeLabel(mode: ControlMode): string {
  if (mode === "agent") return "agent";
  if (mode === "nudge") return "nudge — tools frozen";
  return "drive — human control";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

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

  // Drive keys + Escape → agent. Chat focus is ignored for game keys: we
  // always consume mapped keys while in drive so the chat bar cannot steal them.
  useEffect(() => {
    if (mode !== "drive") return;

    const onKeyDown = (ev: KeyboardEvent) => {
      const action = resolveDriveKey(ev.key, mode);
      if (action.kind === "none") return;

      // Drive owns these keys while mode is drive: preventDefault + stopPropagation
      // so Enter/arrows/Shift never reach the chat bar even if it has focus.
      ev.preventDefault();
      ev.stopPropagation();

      if (action.kind === "setMode") {
        void setMode("agent");
        return;
      }

      if (ev.repeat) return;

      // Soft-refocus live view if user clicked into chat (ignore chat focus).
      if (isEditableTarget(ev.target)) {
        const live = document.querySelector<HTMLElement>('[data-testid="live-view"]');
        live?.focus({ preventScroll: true });
      }

      if (!window.studio?.driveInput) {
        setError("driveInput IPC missing");
        return;
      }
      void window.studio
        .driveInput([action.button])
        .then(() => {
          setLastInput(action.button);
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "driveInput failed");
        });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, setMode]);

  return (
    <section className="panel override-controls">
      <div className="override-header">
        <h2>Override</h2>
        <div
          className={modePillClass(mode)}
          data-testid="mode-badge"
          aria-live="polite"
          title="Current control mode"
        >
          <span className="dot" />
          mode: {modeLabel(mode)}
        </div>
      </div>
      <div className="row override-buttons">
        <button
          type="button"
          className={mode === "nudge" ? "active" : undefined}
          disabled={disabled || busy}
          onClick={() => void setMode("nudge")}
          title="Rescue: pause agent and re-prompt"
        >
          Nudge
        </button>
        <button
          type="button"
          className={mode === "drive" ? "active" : undefined}
          disabled={disabled || busy}
          onClick={() => void setMode("drive")}
          title="Rescue: you control the game"
        >
          Drive
        </button>
        <button
          type="button"
          className={mode === "agent" ? "active primary" : "primary"}
          disabled={disabled || busy}
          data-testid="return-to-agent"
          onClick={() => void setMode("agent")}
        >
          {mode === "drive" ? "Return to Agent" : "Resume Agent"}
        </button>
      </div>

      {mode === "drive" ? (
        <p className="muted">
          Live view focused. Keys: arrows · Z=A · X=B · Enter=START · Shift=SELECT.
          Escape or Return to Agent → agent. Chat focus is ignored for game keys.
        </p>
      ) : mode === "nudge" ? (
        <p className="muted">
          Nudge freezes agent tools (POST /input → 409). Chat still works for
          coaching; Resume Agent to unfreeze.
        </p>
      ) : (
        <p className="muted">
          Agent mode: Hermes/skill may POST /input. Nudge pauses tools; Drive
          enables local keys via IPC.
        </p>
      )}

      {lastInput && mode === "drive" ? (
        <p className="muted">last input: {lastInput}</p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
