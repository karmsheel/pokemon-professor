"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSaves } from "@/lib/control-client";
import {
  CollapsibleSection,
  CollapsibleSectionContent,
  CollapsibleSectionHeader,
} from "@/components/ui/collapsible-section";

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
  bridgeUp?: boolean;
  bridgePort?: number | null;
  romLoaded?: boolean;
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
  const [resumeId, setResumeId] = useState("");

  // Default-open state: only Run and Savestate open by default
  const [openSections, setOpenSections] = useState({
    emulator: false,
    rom: false,
    run: true,
    resume: false,
    mission: false,
    savestate: true,
  });

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
    const t = setInterval(() => {
      void refreshEmuInfo();
    }, 3000);
    return () => clearInterval(t);
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
      const p = await window.studio.pickRom();
      if (p) {
        setPickedRom(p);
        setStatus(`ROM: ${p}`);
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
      const p = pickedRom ?? "C:\\mock\\firered.gba";
      if (emuInfo?.bridgeUp) {
        setStatus("Bridge online — attaching (no second mGBA)…");
      } else if (emuInfo?.backendKind === "mgba" || emuInfo?.choice === "mgba") {
        setStatus(
          "Starting mGBA… After the window opens, load the bridge script: Tools → Scripting → Load script (see path below). Waiting up to 60s for TCP :7947."
        );
      }
      const run = await window.studio.createRun(p);
      onRunStarted(run, p);
      setPickedRom(p);
      const how =
        run.connect === "attach"
          ? "attached to running mGBA"
          : run.connect === "spawn"
            ? "spawned mGBA"
            : emuInfo?.backendKind ?? "emulator";
      setStatus(`Run ${run.id} · ${how} — Live view should show frames`);
      await refreshEmuInfo();
      await refreshRuns();
      await refreshSaves();
    });

  const attachBridge = () =>
    withBusy(async () => {
      if (!window.studio?.attachBridge) throw new Error("attachBridge unavailable");
      setStatus("Attaching to mGBA bridge on :7947…");
      const result = await window.studio.attachBridge(pickedRom);
      onRunStarted({ id: result.id }, result.rom_path);
      setPickedRom(result.rom_path);
      setStatus(
        `Attached to bridge · run ${result.id.slice(0, 8)}… — watch Live view`
      );
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

  const sectionDisabled = disabled || busy || !hasStudio;

  return (
    <section className="panel">
      <h2>
        Run rail <span className="muted">Advanced</span>
      </h2>
      <div className="stack">
        {/* --- Emulator & Bridge --- */}
        <CollapsibleSection
          isExpanded={openSections.emulator}
          onToggle={() => setOpenSections((p) => ({ ...p, emulator: !p.emulator }))}
          label="Emulator &amp; Bridge"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.emulator}
            onToggle={() =>
              setOpenSections((p) => ({ ...p, emulator: !p.emulator }))
            }
            label="Emulator &amp; Bridge"
          >
            <div className="status-pill">
              <span className="dot" />
              emulator: {emuInfo?.backendKind ?? "…"}
              {emuInfo?.env ? ` (PP_EMULATOR=${emuInfo.env})` : ""}
            </div>
            <div className={`status-pill${emuInfo?.bridgeUp ? " ok" : ""}`}>
              <span className="dot" />
              bridge :{emuInfo?.bridgePort ?? 7947}:{" "}
              {emuInfo?.bridgeUp ? "online — Start Run will attach" : "offline"}
              {emuInfo?.romLoaded ? " · studio linked" : ""}
            </div>
          </CollapsibleSectionHeader>
          <CollapsibleSectionContent isExpanded={openSections.emulator}>
            <div className="row">
              <button
                type="button"
                disabled={sectionDisabled}
                onClick={() => void downloadMgba()}
              >
                {emuInfo?.mgbaPresent ? "mGBA ready" : "Download mGBA"}
              </button>
            </div>
            {emuInfo?.mgbaPresent ? (
              <p className="muted path-text">{emuInfo.mgbaPath}</p>
            ) : (
              <p className="muted">
                First-run: download official mGBA 0.10.5 into app data (never
                ships ROMs). Requires 7-Zip on PATH or in Program Files.
              </p>
            )}
            {emuInfo?.scriptPath ? (
              <p className="muted path-text" title={emuInfo.scriptPath}>
                Bridge script: {emuInfo.scriptPath}
              </p>
            ) : null}
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- ROM --- */}
        <CollapsibleSection
          isExpanded={openSections.rom}
          onToggle={() => setOpenSections((p) => ({ ...p, rom: !p.rom }))}
          label="ROM"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.rom}
            onToggle={() => setOpenSections((p) => ({ ...p, rom: !p.rom }))}
            label="ROM"
          />
          <CollapsibleSectionContent isExpanded={openSections.rom}>
            <div className="row">
              <button
                type="button"
                disabled={sectionDisabled}
                onClick={() => void pickRom()}
              >
                Pick ROM
              </button>
            </div>
            {pickedRom ? (
              <div className="path-text">{pickedRom}</div>
            ) : (
              <p className="muted">
                No ROM selected (Start Run uses a mock path).
              </p>
            )}
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- Run --- */}
        <CollapsibleSection
          isExpanded={openSections.run}
          onToggle={() => setOpenSections((p) => ({ ...p, run: !p.run }))}
          label="Run"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.run}
            onToggle={() => setOpenSections((p) => ({ ...p, run: !p.run }))}
            label="Run"
          />
          <CollapsibleSectionContent isExpanded={openSections.run}>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={sectionDisabled}
                onClick={() => void startRun()}
              >
                Start Run
              </button>
              <button
                type="button"
                disabled={sectionDisabled || !emuInfo?.bridgeUp}
                onClick={() => void attachBridge()}
                title="Link Studio to mGBA that already has the Lua bridge loaded"
              >
                Attach bridge
              </button>
            </div>
            <p className="muted">
              If mGBA is already playing and the bridge script is loaded,{" "}
              <strong>Start Run</strong> or <strong>Attach bridge</strong>{" "}
              links Studio without opening a second emulator. Then watch the
              center <strong>Live view</strong> panel.
            </p>
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- Resume Run --- */}
        <CollapsibleSection
          isExpanded={openSections.resume}
          onToggle={() => setOpenSections((p) => ({ ...p, resume: !p.resume }))}
          label="Resume Run"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.resume}
            onToggle={() => setOpenSections((p) => ({ ...p, resume: !p.resume }))}
            label="Resume Run"
          />
          <CollapsibleSectionContent isExpanded={openSections.resume}>
            <div className="field">
              <label htmlFor="resume-run">Resume Run</label>
              <select
                id="resume-run"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
                disabled={sectionDisabled || pastRuns.length === 0}
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
                disabled={sectionDisabled || !resumeId}
                onClick={() => void resumeRun()}
                data-testid="resume-run"
              >
                Resume Run
              </button>
              <button
                type="button"
                disabled={sectionDisabled}
                onClick={() => void refreshRuns()}
                title="Refresh run list"
              >
                Refresh
              </button>
            </div>
            <p className="muted">
              Resume starts the backend with the run&apos;s ROM and loads the
              last savestate if one exists (e.g. <code>pre_drive</code>).
            </p>
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- Mission --- */}
        <CollapsibleSection
          isExpanded={openSections.mission}
          onToggle={() =>
            setOpenSections((p) => ({ ...p, mission: !p.mission }))
          }
          label="Mission"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.mission}
            onToggle={() =>
              setOpenSections((p) => ({ ...p, mission: !p.mission }))
            }
            label="Mission"
          />
          <CollapsibleSectionContent isExpanded={openSections.mission}>
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
                disabled={sectionDisabled || !runId}
                onClick={() => void startMission()}
              >
                Start Mission
              </button>
            </div>
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- Savestate --- */}
        <CollapsibleSection
          isExpanded={openSections.savestate}
          onToggle={() =>
            setOpenSections((p) => ({ ...p, savestate: !p.savestate }))
          }
          label="Savestate"
        >
          <CollapsibleSectionHeader
            isExpanded={openSections.savestate}
            onToggle={() =>
              setOpenSections((p) => ({ ...p, savestate: !p.savestate }))
            }
            label="Savestate"
          />
          <CollapsibleSectionContent isExpanded={openSections.savestate}>
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
                disabled={sectionDisabled || !runId}
                onClick={() => void save()}
              >
                Save
              </button>
              <button
                type="button"
                disabled={sectionDisabled || !runId}
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
          </CollapsibleSectionContent>
        </CollapsibleSection>

        {/* --- Status & errors --- */}
        <div className="status-pill">
          <span className="dot" />
          run: {runId ?? "none"}
        </div>
        {status ? <p className="muted">{status}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {!hasStudio ? (
          <p className="error-text">
            Not running in Electron — IPC disabled. Open via{" "}
            <code>npx electron .</code>.
          </p>
        ) : null}
      </div>
    </section>
  );
}
