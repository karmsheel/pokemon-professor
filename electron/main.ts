import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import { createControlServer } from "./control-api/server";
import { ModeMachine } from "./control-api/mode-machine";
import { MockBackend } from "./emulator/mock-backend";
import { MgbaBackend } from "./emulator/mgba-backend";
import {
  downloadMgba,
  ensureMgbaBinary,
  isMgbaPresent,
  MgbaMissingError,
  mgbaExePath,
} from "./emulator/mgba-download";
import { resolveBridgeScript, resolveForkExe } from "./emulator/mgba-supervisor";
import type { EmulatorBackend } from "./emulator/backend";
import { CaptureScheduler } from "./emulator/capture-scheduler";
import { RunStore } from "./runs/store";
import { appLayout } from "./paths";
import {
  VALID_BUTTONS,
  type Button,
  type ControlMode,
} from "./control-api/types";
import type { ControlContext } from "./control-api/context";
import {
  loadStudioSettings,
  saveStudioSettings,
} from "./settings-store";
import { restartHermesGateway } from "./hermes-gateway";
import {
  detectHermesApiServerEnv,
  fillHermesAuthGaps,
} from "../lib/hermes-env";
import {
  HERMES_DOCS_URL,
  isValidHermesBaseUrl,
  normalizeHermesSettings,
  type HermesSettings,
} from "../lib/hermes-settings";
import { StudentStore } from "./students/store";
import { AgentRuntime } from "./agents/agent-runtime";
import { probeHermesAcp } from "./agents/hermes-cli";
import type { StudentAvatar } from "./students/types";
import { ControlActivityTracker } from "./control-api/activity";
import { installPokemonProfessorSkill } from "./agents/hermes-skills";

let mainWindow: BrowserWindow | null = null;
let controlUrl = "";
let backend: EmulatorBackend;
let mode: ModeMachine;
let store: RunStore;
let studentStore: StudentStore;
let agentRuntime: AgentRuntime;
let currentRunId: string | null = null;
let layout: ReturnType<typeof appLayout>;
let emulatorChoice: "mock" | "mgba" = "mock";
let capture: CaptureScheduler;
/** Mutable control context so backend swaps stay visible to the HTTP server. */
let controlCtx: ControlContext;

function resolveEmulatorChoice(userData: string): "mock" | "mgba" {
  const env = (process.env.PP_EMULATOR || "").toLowerCase().trim();
  if (env === "mock") return "mock";
  if (env === "mgba") return "mgba";
  // Auto: prefer mGBA when stock binary or headless fork is present
  if (isMgbaPresent(userData) || resolveForkExe(userData) != null) return "mgba";
  return "mock";
}

function createBackend(choice: "mock" | "mgba", userData: string): EmulatorBackend {
  if (choice === "mgba") {
    let exe: string;
    try {
      exe = ensureMgbaBinary(userData);
    } catch {
      // Allow constructing MgbaBackend after a later ensureMgba download;
      // createRun will re-check and fail clearly if still missing.
      exe = mgbaExePath(userData);
    }
    // Prefer the Pokemon Professor headless fork when present: it auto-starts
    // the control bridge with no window and no manual Lua load step.
    const forkExe = resolveForkExe(userData);
    if (forkExe) {
      return new MgbaBackend({
        exePath: forkExe,
        scriptPath: resolveBridgeScript(),
        headless: true,
      });
    }
    return new MgbaBackend({
      exePath: exe,
      scriptPath: resolveBridgeScript(),
    });
  }
  return new MockBackend();
}

function setBackend(next: EmulatorBackend) {
  backend = next;
  if (controlCtx) controlCtx.backend = next;
}

async function bootstrap() {
  layout = appLayout(app.getPath("userData"));
  store = new RunStore(layout.runs);
  studentStore = new StudentStore(app.getPath("userData"));
  agentRuntime = new AgentRuntime(studentStore);
  mode = new ModeMachine();
  emulatorChoice = resolveEmulatorChoice(app.getPath("userData"));
  backend = createBackend(emulatorChoice, app.getPath("userData"));

  // CaptureScheduler uses a getBackend closure so setBackend swaps stay live.
  capture = new CaptureScheduler(() => controlCtx.backend);
  controlCtx = {
    mode,
    backend,
    capture,
    getRunId: () => currentRunId,
    getSaveDir: () =>
      currentRunId ? layout.saves(currentRunId) : path.join(layout.root, "orphan-saves"),
    activity: new ControlActivityTracker(),
  };

  const server = await createControlServer(controlCtx, {
    host: "127.0.0.1",
    port: 7946,
  });
  controlUrl = server.url;
  agentRuntime.setControlUrl(controlUrl);

  // Hermes ACP: install play skill into ~/.hermes/skills (and coder profile)
  try {
    const skillInstall = installPokemonProfessorSkill();
    if (skillInstall.errors.length) {
      process.stderr.write(
        `[skills] install warnings: ${skillInstall.errors.join("; ")}\n`
      );
    } else {
      process.stderr.write(
        `[skills] pokemon-professor → ${skillInstall.installed.length} path(s)\n`
      );
    }
  } catch (e) {
    process.stderr.write(
      `[skills] install failed: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  agentRuntime.on("event", (payload) => {
    mainWindow?.webContents.send("studio:agentEvent", payload);
  });

  // Headless E2E hook: POST /run starts a run exactly like studio:createRun.
  controlCtx.startRun = async (romPath: string) => {
    const run = store.create({ rom_path: romPath });
    currentRunId = run.id;
    const connect = await startOrAttachBackend(romPath);
    if (backend.isRomLoaded()) capture.start();
    return { id: run.id, connect };
  };

  ipcMain.handle("studio:getControlUrl", () => controlUrl);
  ipcMain.handle("studio:getPaths", () => layout);
  ipcMain.handle("studio:getEmulatorInfo", async () => {
    const userData = app.getPath("userData");
    const present = isMgbaPresent(userData);
    const scriptPath =
      backend.kind === "mgba" && backend instanceof MgbaBackend
        ? backend.getScriptPath()
        : (() => {
            try {
              return resolveBridgeScript();
            } catch {
              return null;
            }
          })();
    let bridgeUp = false;
    let bridgePort: number | null = null;
    if (backend instanceof MgbaBackend) {
      bridgePort = backend.getBridgePort();
      bridgeUp = await backend.isBridgeUp(600);
    } else {
      // Probe default port even on mock so UI can offer attach after user loads script
      try {
        const probe = new MgbaBackend({
          exePath: present ? mgbaExePath(userData) : "mGBA.exe",
          scriptPath: resolveBridgeScript(),
        });
        bridgePort = probe.getBridgePort();
        bridgeUp = await probe.isBridgeUp(600);
      } catch {
        bridgePort = 7947;
        bridgeUp = false;
      }
    }
    return {
      choice: emulatorChoice,
      backendKind: backend.kind,
      mgbaPresent: present,
      mgbaPath: present ? mgbaExePath(userData) : null,
      scriptPath,
      env: process.env.PP_EMULATOR || null,
      bridgeUp,
      bridgePort,
      romLoaded: backend.isRomLoaded(),
    };
  });
  ipcMain.handle("studio:ensureMgba", async () => {
    const userData = app.getPath("userData");
    if (isMgbaPresent(userData)) {
      // Hot-swap to mGBA if we were on mock and user downloaded / already has it
      if (backend.kind !== "mgba" && (process.env.PP_EMULATOR || "").toLowerCase() !== "mock") {
        await backend.stop().catch(() => undefined);
        emulatorChoice = "mgba";
        setBackend(createBackend("mgba", userData));
      }
      return {
        ok: true as const,
        downloaded: false,
        path: mgbaExePath(userData),
        backendKind: backend.kind,
      };
    }
    const exe = await downloadMgba(userData);
    if ((process.env.PP_EMULATOR || "").toLowerCase() !== "mock") {
      await backend.stop().catch(() => undefined);
      emulatorChoice = "mgba";
      setBackend(createBackend("mgba", userData));
    }
    return {
      ok: true as const,
      downloaded: true,
      path: exe,
      backendKind: backend.kind,
    };
  });
  ipcMain.handle("studio:listRuns", () => store.list());
  ipcMain.handle("studio:pickRom", async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "GBA ROM", extensions: ["gba"] }],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  async function ensureBackendReadyForRom() {
    if (emulatorChoice === "mgba" || backend.kind === "mgba" || (process.env.PP_EMULATOR || "").toLowerCase() === "mgba") {
      const userData = app.getPath("userData");
      // Prefer mGBA when attaching to a live bridge even if we started on mock.
      // Headless fork is sufficient even when stock ensureMgbaBinary fails.
      const forkExe = resolveForkExe(userData);
      if (!forkExe) {
        try {
          ensureMgbaBinary(userData);
        } catch (err) {
          // Allow attach without local binary if bridge is already up
          const probe = new MgbaBackend({
            exePath: "mGBA.exe",
            scriptPath: resolveBridgeScript(),
          });
          if (!(await probe.isBridgeUp(600))) {
            if (err instanceof MgbaMissingError) {
              throw new Error(
                "mGBA is not installed. Use “Download mGBA” in the Run rail, or set PP_EMULATOR=mock."
              );
            }
            throw err;
          }
        }
      }
      // Stock path (no fork): UI may later surface a system message that the
      // Lua bridge must be loaded manually; ChatBar wiring deferred.
      if (backend.kind !== "mgba") {
        // Switch mock → mgba without killing external emulator
        setBackend(createBackend("mgba", userData));
        emulatorChoice = "mgba";
      }
      // Do NOT recreate MgbaBackend if already mgba — that would drop attach state
    }
  }

  async function startOrAttachBackend(romPath: string): Promise<"attach" | "spawn" | "mock"> {
    await ensureBackendReadyForRom();
    if (backend instanceof MgbaBackend) {
      // stop() only kills mGBA if we spawned it (ownsProcess)
      await backend.start(romPath, { preferAttach: true });
      return backend.lastConnectMode === "spawn" ? "spawn" : "attach";
    }
    await backend.stop().catch(() => undefined);
    await backend.start(romPath);
    return "mock";
  }

  ipcMain.handle("studio:createRun", async (_e, romPath: string) => {
    const run = store.create({ rom_path: romPath });
    currentRunId = run.id;
    const modeStarted = await startOrAttachBackend(romPath);
    if (backend.isRomLoaded()) capture.start();
    store.appendEvent(run.id, {
      type: "run_started",
      detail: { emulator: backend.kind, connect: modeStarted },
    });
    return { ...run, connect: modeStarted };
  });

  /**
   * Start game from chat: create run, start/attach backend, set agent mode.
   * ROM from arg or lastRomPath settings.
   */
  ipcMain.handle(
    "studio:startGame",
    async (_e, romPathArg?: string | null) => {
      const userData = app.getPath("userData");
      const settings = loadStudioSettings(userData);
      const romPath =
        (romPathArg && romPathArg.trim()) || settings.lastRomPath;
      if (!romPath) {
        throw new Error("No ROM selected. Load a FireRed .gba first.");
      }
      if (!fs.existsSync(romPath)) {
        throw new Error(
          `ROM not found: ${romPath}. Load a FireRed .gba again.`
        );
      }
      // Agent-first Start game: never silently fall back to mock unless opted in.
      if ((process.env.PP_EMULATOR || "").toLowerCase().trim() !== "mock") {
        if (resolveForkExe(userData) == null && !isMgbaPresent(userData)) {
          throw new Error(
            "No emulator available. Build/install the headless mGBA fork (vendor/mgba/build) or Download mGBA, then try Start game again."
          );
        }
        // Auto-choice may have been mock at boot; upgrade before start/attach.
        if (backend.kind !== "mgba") {
          setBackend(createBackend("mgba", userData));
          emulatorChoice = "mgba";
        }
      }
      const run = store.create({ rom_path: romPath });
      currentRunId = run.id;
      const connect = await startOrAttachBackend(romPath);
      if (backend.isRomLoaded()) capture.start();
      mode.set("agent");
      saveStudioSettings(userData, { ...settings, lastRomPath: romPath });
      store.appendEvent(run.id, {
        type: "run_started",
        detail: {
          emulator: backend.kind,
          connect,
          source: "start_game",
        },
      });
      return { ...run, rom_path: romPath, connect, mode: "agent" as const };
    }
  );

  /**
   * Attach to an already-running mGBA + bridge without spawning.
   * Creates a run if needed using the given romPath (bookkeeping only).
   */
  ipcMain.handle(
    "studio:attachBridge",
    async (_e, romPath?: string | null) => {
      await ensureBackendReadyForRom();
      if (!(backend instanceof MgbaBackend)) {
        setBackend(createBackend("mgba", app.getPath("userData")));
        emulatorChoice = "mgba";
      }
      if (!(backend instanceof MgbaBackend)) {
        throw new Error("mGBA backend unavailable");
      }
      await backend.attach();
      if (backend.isRomLoaded()) capture.start();
      const pathForRun =
        romPath ||
        (currentRunId ? store.get(currentRunId)?.rom_path : null) ||
        "attached-session.gba";
      if (!currentRunId) {
        const run = store.create({ rom_path: pathForRun });
        currentRunId = run.id;
        store.appendEvent(run.id, {
          type: "run_started",
          detail: { emulator: "mgba", connect: "attach" },
        });
        return {
          id: run.id,
          rom_path: run.rom_path,
          connect: "attach" as const,
        };
      }
      store.appendEvent(currentRunId, {
        type: "bridge_attached",
        detail: { emulator: "mgba" },
      });
      return {
        id: currentRunId,
        rom_path: pathForRun,
        connect: "attach" as const,
      };
    }
  );

  /**
   * Resume Run: select existing run → start backend with rom_path →
   * load last savestate name if present.
   */
  ipcMain.handle("studio:resumeRun", async (_e, runId: string) => {
    const run = store.get(runId);
    if (!run) throw new Error("run not found");
    if (!run.rom_path) throw new Error("run has no rom_path");

    currentRunId = run.id;
    const modeStarted = await startOrAttachBackend(run.rom_path);
    if (backend.isRomLoaded()) capture.start();

    const lastSavestate =
      run.savestates.length > 0
        ? run.savestates[run.savestates.length - 1]
        : null;

    if (lastSavestate) {
      await backend.loadState(lastSavestate, layout.saves(run.id));
      store.appendEvent(run.id, {
        type: "loadstate",
        detail: { name: lastSavestate, reason: "resume" },
      });
    }

    store.appendEvent(run.id, {
      type: "run_resumed",
      detail: {
        emulator: backend.kind,
        savestate: lastSavestate,
        connect: modeStarted,
      },
    });

    return {
      id: run.id,
      rom_path: run.rom_path,
      loadedSavestate: lastSavestate,
      connect: modeStarted,
    };
  });
  ipcMain.handle(
    "studio:addMission",
    (_e, runId: string, prompt: string) => {
      const mission = store.addMission(runId, {
        prompt,
        source: "freeform",
      });
      store.appendEvent(runId, {
        type: "mission_started",
        detail: { mission_id: mission.id, prompt },
      });
      return mission;
    }
  );
  ipcMain.handle("studio:setMode", async (_e, next: ControlMode) => {
    const prev = mode.get();
    mode.set(next);
    if (currentRunId && prev !== next) {
      // Nudge/Drive/Resume coach loop events (Task 10 + I3)
      if (next === "nudge") {
        store.appendEvent(currentRunId, { type: "override_nudge_start" });
      } else if (next === "agent") {
        // End the mode we are leaving — never log nudge_end after drive
        if (prev === "drive") {
          store.appendEvent(currentRunId, { type: "override_drive_end" });
        } else if (prev === "nudge") {
          store.appendEvent(currentRunId, { type: "override_nudge_end" });
        }
      } else if (next === "drive") {
        store.appendEvent(currentRunId, { type: "mode_drive" });
      }
    }
    return mode.get();
  });
  ipcMain.handle("studio:save", async (_e, name: string) => {
    if (!currentRunId) throw new Error("no active run");
    const file = await backend.saveState(name, layout.saves(currentRunId));
    store.registerSavestate(currentRunId, name);
    store.appendEvent(currentRunId, { type: "savestate", detail: { name } });

    // First in-game save menu success → durable Student save + session.
    const activeStudentId = studentStore.getActiveStudentId();
    let promoted: { saveId: string; sessionId: string } | null = null;
    if (activeStudentId) {
      try {
        promoted = agentRuntime.markFirstSaveSuccess(activeStudentId, file);
        mainWindow?.webContents.send("studio:firstSavePromoted", {
          studentId: activeStudentId,
          ...promoted,
        });
      } catch {
        /* non-fatal */
      }
    }
    return { name, path: file, promoted };
  });
  ipcMain.handle("studio:load", async (_e, name: string) => {
    if (!currentRunId) throw new Error("no active run");
    await backend.loadState(name, layout.saves(currentRunId));
    store.appendEvent(currentRunId, { type: "loadstate", detail: { name } });
    return { name };
  });
  ipcMain.handle("studio:driveInput", async (_e, buttons: Button[]) => {
    if (mode.get() !== "drive") throw new Error("not in drive mode");
    if (!Array.isArray(buttons) || buttons.length === 0) {
      throw new Error("buttons required");
    }
    if (buttons.length > 5) {
      throw new Error("max 5 buttons per request");
    }
    for (const b of buttons) {
      if (!VALID_BUTTONS.has(b)) {
        throw new Error(`invalid button: ${b}`);
      }
    }
    await backend.press(buttons);
    return { ok: true };
  });

  /**
   * Fill blank Hermes apiKey/baseUrl from process env + Hermes Agent .env
   * (API_SERVER_KEY / API_SERVER_PORT). Persist when we discover a key so the
   * gate does not force users to paste secrets.
   */
  function hydrateHermesSettings(settings: ReturnType<typeof loadStudioSettings>) {
    const filled = fillHermesAuthGaps(settings.hermes);
    const hermes = normalizeHermesSettings({
      baseUrl: filled.baseUrl,
      apiKey: filled.apiKey,
      model: filled.model,
    });
    const changed =
      hermes.apiKey !== settings.hermes.apiKey ||
      hermes.baseUrl !== settings.hermes.baseUrl ||
      hermes.model !== settings.hermes.model;
    return {
      settings: { ...settings, hermes },
      changed,
      apiKeySource: filled.apiKeySource,
    };
  }

  ipcMain.handle("studio:getSettings", () => {
    const userData = app.getPath("userData");
    let settings = loadStudioSettings(userData);
    // Drop stale lastRomPath if the file was moved/deleted since last session.
    if (settings.lastRomPath && !fs.existsSync(settings.lastRomPath)) {
      settings = { ...settings, lastRomPath: null };
      saveStudioSettings(userData, settings);
    }
    const hydrated = hydrateHermesSettings(settings);
    if (hydrated.changed) {
      saveStudioSettings(userData, hydrated.settings);
    }
    return hydrated.settings;
  });

  ipcMain.handle("studio:detectHermesEnv", () => {
    const detected = detectHermesApiServerEnv();
    const filled = fillHermesAuthGaps({});
    return {
      detected,
      filled: {
        baseUrl: filled.baseUrl,
        apiKey: filled.apiKey,
        model: filled.model,
      },
      apiKeySource: filled.apiKeySource,
      /** Masked for UI — never log full key in renderer status. */
      apiKeyConfigured: Boolean(filled.apiKey),
    };
  });

  ipcMain.handle(
    "studio:setHermesSettings",
    (_e, partial: Partial<HermesSettings>) => {
      const userData = app.getPath("userData");
      const cur = loadStudioSettings(userData);
      // If caller clears apiKey, re-fill from Hermes env instead of saving blank.
      const merged = { ...cur.hermes, ...partial };
      const filled = fillHermesAuthGaps(merged);
      const hermes = normalizeHermesSettings({
        baseUrl: filled.baseUrl,
        apiKey: filled.apiKey || merged.apiKey,
        model: filled.model,
      });
      if (!isValidHermesBaseUrl(hermes.baseUrl)) {
        throw new Error("Invalid Hermes base URL (use http:// or https://)");
      }
      const next = { ...cur, hermes };
      saveStudioSettings(userData, next);
      return next;
    }
  );

  ipcMain.handle("studio:setLastRomPath", (_e, romPath: string | null) => {
    const userData = app.getPath("userData");
    const cur = loadStudioSettings(userData);
    const next = {
      ...cur,
      lastRomPath: romPath && romPath.trim() ? romPath : null,
    };
    saveStudioSettings(userData, next);
    return next;
  });

  ipcMain.handle("studio:openHermesDocs", async () => {
    await shell.openExternal(HERMES_DOCS_URL);
  });

  ipcMain.handle(
    "studio:restartHermesGateway",
    async (_e, override?: Partial<HermesSettings>) => {
      const cur = loadStudioSettings(app.getPath("userData"));
      const hermes = normalizeHermesSettings({ ...cur.hermes, ...override });
      if (!isValidHermesBaseUrl(hermes.baseUrl)) {
        return {
          ok: false as const,
          message: "Enter a valid http(s) Hermes URL before restarting.",
        };
      }
      return restartHermesGateway({
        baseUrl: hermes.baseUrl,
        apiKey: hermes.apiKey,
      });
    }
  );

  /** Primary gate: Hermes CLI + `hermes acp --check` (gateway disabled). */
  ipcMain.handle("studio:probeHermesAcp", async () => {
    return probeHermesAcp();
  });

  // Legacy name kept for older UI bits — now ACP check, not gateway HTTP.
  ipcMain.handle(
    "studio:probeHermes",
    async (_e, _override?: Partial<HermesSettings>) => {
      const r = await probeHermesAcp();
      if (r.ok) return { ok: true as const, cli: r.cli };
      return {
        ok: false,
        error: r.error,
        hint: r.hint,
        cli: r.cli,
      };
    }
  );

  // ── Students + dual-agent (GA / Student) ─────────────────────────────────

  ipcMain.handle("studio:listStudents", () => {
    const index = studentStore.loadIndex();
    return {
      students: index.students,
      activeStudentId: index.activeStudentId,
      metGa: index.metGa,
    };
  });

  ipcMain.handle("studio:setMetGa", (_e, met: boolean) => {
    return studentStore.setMetGa(Boolean(met));
  });

  ipcMain.handle(
    "studio:createStudent",
    (
      _e,
      input: { name: string; avatar: StudentAvatar; backstory?: string }
    ) => {
      return studentStore.createStudent(input);
    }
  );

  ipcMain.handle(
    "studio:updateStudent",
    (
      _e,
      id: string,
      patch: Partial<{ name: string; avatar: StudentAvatar; backstory: string }>
    ) => {
      return studentStore.updateStudent(id, patch);
    }
  );

  ipcMain.handle("studio:setActiveStudent", async (_e, id: string | null) => {
    if (agentRuntime.isGameStarted()) {
      throw new Error("Cannot switch Student while a game is running");
    }
    return studentStore.setActiveStudentId(id);
  });

  ipcMain.handle("studio:getGaThread", () => {
    agentRuntime.seedGaWelcomeIfEmpty();
    return studentStore.loadGaThread();
  });

  ipcMain.handle("studio:ensureGa", async () => {
    agentRuntime.seedGaWelcomeIfEmpty();
    try {
      await agentRuntime.ensureGa();
    } catch {
      /* ACP warm-up non-fatal; welcome text still available */
    }
    return studentStore.loadGaThread();
  });

  ipcMain.handle("studio:getStudentPlaySession", (_e, studentId: string) => {
    const student = studentStore.getStudent(studentId);
    if (!student) return null;
    if (student.lastUsedSaveId) {
      const save = studentStore.getSave(studentId, student.lastUsedSaveId);
      if (save?.lastSessionId) {
        const session = studentStore.loadSession(
          studentId,
          save.id,
          save.lastSessionId
        );
        if (session) {
          return { provisional: false, save, session };
        }
      }
    }
    const provisional = studentStore.loadProvisionalSession(studentId);
    if (provisional) {
      return { provisional: true, save: null, session: provisional };
    }
    return {
      provisional: true,
      save: null,
      session: null,
      gameStarted: agentRuntime.isGameStarted(),
    };
  });

  ipcMain.handle("studio:sendGaMessage", async (_e, text: string) => {
    return agentRuntime.sendGa(text);
  });

  ipcMain.handle(
    "studio:sendStudentMessage",
    async (_e, studentId: string, text: string) => {
      return agentRuntime.sendStudent(studentId, text);
    }
  );

  ipcMain.handle(
    "studio:startStudentPlay",
    async (
      _e,
      studentId: string,
      opts?: { missionBrief?: string }
    ) => {
      agentRuntime.setControlUrl(controlUrl);
      return agentRuntime.startStudentPlay(studentId, opts);
    }
  );

  ipcMain.handle(
    "studio:seedStudentIntro",
    (
      _e,
      studentId: string,
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
    ) => {
      return studentStore.seedIntroConversation(studentId, messages);
    }
  );

  ipcMain.handle(
    "studio:completeStudentCutscene",
    async (
      _e,
      input: {
        name: string;
        avatar: StudentAvatar;
        missionBrief: string;
        introMessages: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      }
    ) => {
      // Create Student + intro first so cutscene never depends on model latency.
      const student = studentStore.createStudent({
        name: input.name,
        avatar: input.avatar,
        backstory: input.missionBrief,
      });
      studentStore.seedIntroConversation(student.id, input.introMessages);
      agentRuntime.setControlUrl(controlUrl);

      // Spawns hermes acp + queues first play turn in background.
      // Does NOT wait for the full agent reply (that was freezing "Connecting Student…").
      const play = await agentRuntime.startStudentPlay(student.id, {
        missionBrief: input.missionBrief,
        waitForFirstReply: false,
      });
      return {
        student: play.student,
        provisional: play.provisional,
        session: play.session,
      };
    }
  );

  ipcMain.handle("studio:stopStudentPlay", async () => {
    return agentRuntime.stopStudent();
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.PP_DEV_URL || "http://127.0.0.1:3848";
  if (process.env.PP_DEV_URL || !app.isPackaged) {
    await mainWindow.loadURL(devUrl);
  } else {
    // __dirname is dist-electron/electron → repo out/ is two levels up
    const indexCandidates = [
      path.join(__dirname, "..", "..", "out", "index.html"),
      path.join(process.cwd(), "out", "index.html"),
    ];
    const indexHtml =
      indexCandidates.find((p) => fs.existsSync(p)) ?? indexCandidates[0];
    await mainWindow.loadFile(indexHtml);
  }
}

app.whenReady().then(bootstrap);

app.on("before-quit", () => {
  capture?.stop();
  // stop() only kills mGBA if Studio spawned it (attach leaves external mGBA running)
  void backend?.stop().catch(() => undefined);
  void (async () => {
    try {
      const r = await agentRuntime?.stopStudent();
      if (r?.discardedProvisional) {
        // Student setup is kept; flag for toast on next launch.
        const flag = path.join(app.getPath("userData"), "provisional-discarded.json");
        fs.writeFileSync(
          flag,
          JSON.stringify({ at: new Date().toISOString() }),
          "utf8"
        );
      }
    } catch {
      /* ignore */
    }
    await agentRuntime?.shutdown().catch(() => undefined);
  })();
});

ipcMain.handle("studio:consumeProvisionalDiscardToast", () => {
  const flag = path.join(app.getPath("userData"), "provisional-discarded.json");
  if (!fs.existsSync(flag)) return null;
  try {
    fs.unlinkSync(flag);
  } catch {
    /* ignore */
  }
  return {
    message:
      "Game progress before the first save menu wasn't kept. Your Student setup is safe — load the ROM and Start game to continue.",
  };
});
