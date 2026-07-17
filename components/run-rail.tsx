"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSaves } from "@/lib/control-client";

type RunSummary = {
  id: string;
  rom_path: string;
  created_at: string;
  status: string;
  savestates: string[];
};

type RunRailProps = {
  runId: string | null;
  romPath: string | null;
  controlUrl?: string | null;
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

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatRunLabel(run: RunSummary): string {
  const when = run.created_at ? run.created_at.slice(0, 19).replace("T", " ") : "?";
  const saves =
    run.savestates.length > 0
      ? ` · last save: ${run.savestates[run.savestates.length - 1]}`
      : " · no saves";
  const rom = run.rom_path.split(/[/\\]/).pop() || run.rom_path;
  return `${shortId(run.id)} · ${rom} · ${when}${saves}`;
}

export function RunRail({
  runId,
  romPath,
  controlUrl,
  onRunStarted,
  disabled,
}: RunRailProps) {
  const [pickedRom, setPickedRom] = useState<string | null>(romPath);
  const [mission, setMission] = useState("");
  const [saveName, setSaveName] = useState("slot1");
  const [saveList, setSaveList] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasStudio, setHasStudio] = useState(false);
  const [emuInfo, setEmuInfo] = useState<EmuInfo | null>(null);
  const [pastRuns, setPastRuns] = useState<RunSummary[]>([]);
  const [resumeId, setResumeId] = useState<string>("");

  const refreshEmuInfo = async () => {
    if (!window.studio?.getEmulatorInfo) return;
    try {
      const info = await window.studio.getEmulatorInfo();
      setEmuInfo(info);
    } catch {
      /* ignore */
    }
  };

  const refreshRuns = useCallback(async () => {
    if (!window.studio?.listRuns) return;
    try {
      const list = await window.studio.listRuns();
      setPastRuns(list);
      setResumeId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSaves = useCallback(async () => {
    // Prefer Control API GET /saves for the active run's save dir.
    if (controlUrl && runId) {
      try {
        const { saves } = await fetchSaves(controlUrl);
        setSaveList(saves);
        return;
      } catch {
        /* fall through to run metadata */
      }
    }
    // Fallback: savestate names from listRuns metadata
    if (runId && pastRuns.length) {
      const match = pastRuns.find((r) => r.id === runId);
      if (match) setSaveList(match.savestates);
    }
  }, [controlUrl, runId, pastRuns]);

  useEffect(() => {
    setHasStudio(Boolean(window.studio));
    void refreshEmuInfo();
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    void refreshSaves();
  }, [refreshSaves, runId]);

  // Poll save list while a run is active (cheap; after Save/Load UX).
  useEffect(() => {
    if (!controlUrl || !runId) return;
    const t = setInterval(() => {
      void refreshSaves();
    }, 3000);
    return () => clearInterval(t);
  }, [controlUrl, runId, refreshSaves]);

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
      await refreshRuns();
      await refreshSaves();
    });

  const resumeRun = () =>
    withBusy(async () => {
      if (!window.studio?.resumeRun) throw new Error("resumeRun unavailable");
      if (!resumeId) throw new Error("select a run to resume");
      const selected = pastRuns.find((r) => r.id === resumeId);
      if (emuInfo?.backendKind === "mgba" || emuInfo?.choice === "mgba") {
        setStatus(
          "Resuming… After mGBA opens, load the bridge script if needed. Loading last savestate if present."
        );
      }
      const result = await window.studio.resumeRun(resumeId);
      onRunStarted({ id: result.id }, result.rom_path);
      setPickedRom(result.rom_path);
      const lastHint =
        result.loadedSavestate ??
        selected?.savestates[selected.savestates.length - 1] ??
        null;
      setStatus(
        lastHint
          ? `Resumed ${shortId(result.id)} · loaded savestate "${lastHint}"`
          : `Resumed ${shortId(result.id)} · no savestate (fresh ROM boot)`
      );
      if (lastHint) setSaveName(lastHint);
      await refreshEmuInfo();
      await refreshRuns();
      await refreshSaves();
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
      await refreshRuns();
      await refreshSaves();
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
          <label htmlFor="resume-run">Resume Run</label>
          <select
            id="resume-run"
            value={resumeId}
            onChange={(e) => setResumeId(e.target.value)}
            disabled={disabled || busy || !hasStudio || pastRuns.length === 0}
          >
            {pastRuns.length === 0 ? (
              <option value="">No past runs</option>
            ) : (
              pastRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatRunLabel(r)}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            disabled={disabled || busy || !hasStudio || !resumeId}
            onClick={() => void resumeRun()}
            data-testid="resume-run"
          >
            Resume Run
          </button>
          <button
            type="button"
            disabled={disabled || busy || !hasStudio}
            onClick={() => void refreshRuns()}
            title="Refresh run list"
          >
            Refresh
          </button>
        </div>
        <p className="muted">
          Resume starts the backend with the run&apos;s ROM and loads the last
          savestate if one exists (e.g. <code>pre_drive</code>).
        </p>

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
          {saveList.length > 0 ? (
            <select
              id="save-list"
              value={saveList.includes(saveName) ? saveName : ""}
              onChange={(e) => {
                if (e.target.value) setSaveName(e.target.value);
              }}
              disabled={disabled || busy}
              aria-label="Known savestates"
            >
              <option value="">— pick existing —</option>
              {saveList.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            id="save-name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={disabled || busy}
            placeholder="e.g. pre_drive"
            list="save-name-suggestions"
          />
          {saveList.length > 0 ? (
            <datalist id="save-name-suggestions">
              {saveList.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
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
        {saveList.length > 0 ? (
          <p className="muted">Known saves: {saveList.join(", ")}</p>
        ) : runId ? (
          <p className="muted">No savestates yet for this run.</p>
        ) : null}

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
