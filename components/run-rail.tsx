"use client";

import { useEffect, useState } from "react";

type RunRailProps = {
  runId: string | null;
  romPath: string | null;
  onRunStarted: (run: { id: string }, romPath: string) => void;
  disabled?: boolean;
};

export function RunRail({
  runId,
  romPath,
  onRunStarted,
  disabled,
}: RunRailProps) {
  const [pickedRom, setPickedRom] = useState<string | null>(romPath);
  const [mission, setMission] = useState("");
  const [saveName, setSaveName] = useState("slot1");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasStudio, setHasStudio] = useState(false);

  useEffect(() => {
    setHasStudio(Boolean(window.studio));
  }, []);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  };

  const pickRom = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      const path = await window.studio.pickRom();
      if (path) {
        setPickedRom(path);
        setStatus(`ROM: ${path}`);
      }
    });

  const startRun = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      const path = pickedRom ?? "C:\\mock\\firered.gba";
      const run = await window.studio.createRun(path);
      onRunStarted(run, path);
      setPickedRom(path);
      setStatus(`Run ${run.id} started`);
    });

  const startMission = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      if (!runId) throw new Error("no active run");
      const prompt = mission.trim();
      if (!prompt) throw new Error("mission prompt required");
      await window.studio.addMission(runId, prompt);
      setStatus(`Mission added: ${prompt}`);
    });

  const save = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      if (!saveName.trim()) throw new Error("save name required");
      await window.studio.save(saveName.trim());
      setStatus(`Saved "${saveName.trim()}"`);
    });

  const load = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      if (!saveName.trim()) throw new Error("save name required");
      await window.studio.load(saveName.trim());
      setStatus(`Loaded "${saveName.trim()}"`);
    });

  return (
    <section className="panel">
      <h2>Run rail</h2>
      <div className="stack">
        <div className="row">
          <button type="button" disabled={disabled || busy || !hasStudio} onClick={() => void pickRom()}>
            Pick ROM
          </button>
        </div>
        {pickedRom ? <div className="path-text">{pickedRom}</div> : (
          <p className="muted">No ROM selected (Start Run uses a mock path).</p>
        )}

        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={disabled || busy || !hasStudio}
            onClick={() => void startRun()}
          >
            Start Run
          </button>
        </div>

        <div className="field">
          <label htmlFor="mission">Mission</label>
          <input
            id="mission"
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder="e.g. leave Oak's lab"
            disabled={disabled || busy}
          />
        </div>
        <div className="row">
          <button
            type="button"
            disabled={disabled || busy || !hasStudio || !runId}
            onClick={() => void startMission()}
          >
            Start Mission
          </button>
        </div>

        <div className="field">
          <label htmlFor="save-name">Savestate</label>
          <input
            id="save-name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={disabled || busy}
          />
        </div>
        <div className="row">
          <button
            type="button"
            disabled={disabled || busy || !hasStudio || !runId}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            disabled={disabled || busy || !hasStudio || !runId}
            onClick={() => void load()}
          >
            Load
          </button>
        </div>

        <div className="status-pill">
          <span className="dot" />
          run: {runId ?? "none"}
        </div>
        {status ? <p className="muted">{status}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {!hasStudio ? (
          <p className="error-text">
            Not running in Electron — IPC disabled. Open via `npx electron .`.
          </p>
        ) : null}
      </div>
    </section>
  );
}
