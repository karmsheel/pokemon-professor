"use client";

import { useEffect, useState } from "react";

type RunRailProps = {
  runId: string | null;
  romPath: string | null;
  onRunStarted: (run: { id: string }, romPath: string) => void;
  disabled?: boolean;
};

type EmuInfo = {
  choice: "mock" | "mgba";
  backendKind: "mock" | "mgba";
  mgbaPresent: boolean;
  mgbaPath: string | null;
  scriptPath: string | null;
  env: string | null;
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
  const [emuInfo, setEmuInfo] = useState<EmuInfo | null>(null);

  const refreshEmuInfo = async () => {
    if (!window.studio?.getEmulatorInfo) return;
    try {
      const info = await window.studio.getEmulatorInfo();
      setEmuInfo(info);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    setHasStudio(Boolean(window.studio));
    void refreshEmuInfo();
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

  const downloadMgba = () =>
    withBusy(async () => {
      if (!window.studio?.ensureMgba) throw new Error("ensureMgba unavailable");
      setStatus("Downloading mGBA (checksum-verified)…");
      const result = await window.studio.ensureMgba();
      await refreshEmuInfo();
      setStatus(
        result.downloaded
          ? `mGBA installed → ${result.path}`
          : `mGBA already present → ${result.path}`
      );
    });

  const startRun = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      const path = pickedRom ?? "C:\\mock\\firered.gba";
      if (emuInfo?.backendKind === "mgba" || emuInfo?.choice === "mgba") {
        setStatus(
          "Starting mGBA… After the window opens, load the bridge script: Tools → Scripting → Load script (see path below). Waiting up to 60s for TCP :7947."
        );
      }
      const run = await window.studio.createRun(path);
      onRunStarted(run, path);
      setPickedRom(path);
      setStatus(`Run ${run.id} started (${emuInfo?.backendKind ?? "emulator"})`);
      await refreshEmuInfo();
    });

  const startMission = () =>
    withBusy(async () => {
      if (!window.studio) throw new Error("window.studio unavailable");
      if (!runId) throw new Error("no active run");
      const prompt = mission.trim();
      if (!prompt) throw new Error("mission prompt required");
      // store.addMission pauses any previously active mission automatically
      const created = (await window.studio.addMission(runId, prompt)) as {
        id?: string;
        status?: string;
      };
      setStatus(
        `Mission active: ${prompt}${created?.id ? ` (${created.id.slice(0, 8)}…)` : ""}`
      );
      setMission("");
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
        <div className="status-pill">
          <span className="dot" />
          emulator: {emuInfo?.backendKind ?? "…"}
          {emuInfo?.env ? ` (PP_EMULATOR=${emuInfo.env})` : ""}
        </div>

        <div className="row">
          <button
            type="button"
            disabled={disabled || busy || !hasStudio}
            onClick={() => void downloadMgba()}
          >
            {emuInfo?.mgbaPresent ? "mGBA ready" : "Download mGBA"}
          </button>
        </div>
        {emuInfo?.mgbaPresent ? (
          <p className="muted path-text">{emuInfo.mgbaPath}</p>
        ) : (
          <p className="muted">
            First-run: download official mGBA 0.10.5 into app data (never ships ROMs).
            Requires 7-Zip on PATH or in Program Files.
          </p>
        )}
        {emuInfo?.scriptPath ? (
          <p className="muted path-text" title={emuInfo.scriptPath}>
            Bridge script: {emuInfo.scriptPath}
          </p>
        ) : null}

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
