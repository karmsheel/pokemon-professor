import { app, BrowserWindow, dialog, ipcMain } from "electron";
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
import { resolveBridgeScript } from "./emulator/mgba-supervisor";
import type { EmulatorBackend } from "./emulator/backend";
import { RunStore } from "./runs/store";
import { appLayout } from "./paths";
import type { Button, ControlMode } from "./control-api/types";

let mainWindow: BrowserWindow | null = null;
let controlUrl = "";
let backend: EmulatorBackend;
let mode: ModeMachine;
let store: RunStore;
let currentRunId: string | null = null;
let layout: ReturnType<typeof appLayout>;
let emulatorChoice: "mock" | "mgba" = "mock";
/** Mutable control context so backend swaps stay visible to the HTTP server. */
let controlCtx: {
  mode: ModeMachine;
  backend: EmulatorBackend;
  getRunId: () => string | null;
  getSaveDir: () => string;
};

function resolveEmulatorChoice(userData: string): "mock" | "mgba" {
  const env = (process.env.PP_EMULATOR || "").toLowerCase().trim();
  if (env === "mock") return "mock";
  if (env === "mgba") return "mgba";
  // Auto: prefer mGBA when binary is already present
  return isMgbaPresent(userData) ? "mgba" : "mock";
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
  mode = new ModeMachine();
  emulatorChoice = resolveEmulatorChoice(app.getPath("userData"));
  backend = createBackend(emulatorChoice, app.getPath("userData"));

  controlCtx = {
    mode,
    backend,
    getRunId: () => currentRunId,
    getSaveDir: () =>
      currentRunId ? layout.saves(currentRunId) : path.join(layout.root, "orphan-saves"),
  };

  const server = await createControlServer(controlCtx, {
    host: "127.0.0.1",
    port: 7946,
  });
  controlUrl = server.url;

  ipcMain.handle("studio:getControlUrl", () => controlUrl);
  ipcMain.handle("studio:getPaths", () => layout);
  ipcMain.handle("studio:getEmulatorInfo", () => {
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
    return {
      choice: emulatorChoice,
      backendKind: backend.kind,
      mgbaPresent: present,
      mgbaPath: present ? mgbaExePath(userData) : null,
      scriptPath,
      env: process.env.PP_EMULATOR || null,
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
    if (emulatorChoice === "mgba" || backend.kind === "mgba") {
      try {
        ensureMgbaBinary(app.getPath("userData"));
      } catch (err) {
        if (err instanceof MgbaMissingError) {
          throw new Error(
            "mGBA is not installed. Use “Download mGBA” in the Run rail, or set PP_EMULATOR=mock."
          );
        }
        throw err;
      }
      // Rebuild backend if exe appeared after construction with missing path
      if (backend.kind !== "mgba") {
        await backend.stop().catch(() => undefined);
        setBackend(createBackend("mgba", app.getPath("userData")));
      } else if (backend instanceof MgbaBackend) {
        // Refresh exe path in a new instance if needed
        const exe = mgbaExePath(app.getPath("userData"));
        await backend.stop().catch(() => undefined);
        setBackend(
          new MgbaBackend({
            exePath: exe,
            scriptPath: resolveBridgeScript(),
          })
        );
      }
    }
  }

  ipcMain.handle("studio:createRun", async (_e, romPath: string) => {
    await ensureBackendReadyForRom();

    const run = store.create({ rom_path: romPath });
    currentRunId = run.id;
    await backend.stop().catch(() => undefined);
    await backend.start(romPath);
    store.appendEvent(run.id, {
      type: "run_started",
      detail: { emulator: backend.kind },
    });
    return run;
  });

  /**
   * Resume Run: select existing run → start backend with rom_path →
   * load last savestate name if present.
   */
  ipcMain.handle("studio:resumeRun", async (_e, runId: string) => {
    const run = store.get(runId);
    if (!run) throw new Error("run not found");
    if (!run.rom_path) throw new Error("run has no rom_path");

    await ensureBackendReadyForRom();

    currentRunId = run.id;
    await backend.stop().catch(() => undefined);
    await backend.start(run.rom_path);

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
      },
    });

    return {
      id: run.id,
      rom_path: run.rom_path,
      loadedSavestate: lastSavestate,
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
      // Nudge/Resume coach loop events (Task 10)
      if (next === "nudge") {
        store.appendEvent(currentRunId, { type: "override_nudge_start" });
      } else if (next === "agent") {
        store.appendEvent(currentRunId, { type: "override_nudge_end" });
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
    return { name, path: file };
  });
  ipcMain.handle("studio:load", async (_e, name: string) => {
    if (!currentRunId) throw new Error("no active run");
    await backend.loadState(name, layout.saves(currentRunId));
    store.appendEvent(currentRunId, { type: "loadstate", detail: { name } });
    return { name };
  });
  ipcMain.handle("studio:driveInput", async (_e, buttons: Button[]) => {
    if (mode.get() !== "drive") throw new Error("not in drive mode");
    await backend.press(buttons);
    return { ok: true };
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
    await mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
  }
}

app.whenReady().then(bootstrap);

app.on("before-quit", () => {
  void backend?.stop().catch(() => undefined);
});
