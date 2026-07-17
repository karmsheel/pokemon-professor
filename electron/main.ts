import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import { createControlServer } from "./control-api/server";
import { ModeMachine } from "./control-api/mode-machine";
import { MockBackend } from "./emulator/mock-backend";
import type { EmulatorBackend } from "./emulator/backend";
import { RunStore } from "./runs/store";
import { appLayout } from "./paths";
import type { ControlMode } from "./control-api/types";

let mainWindow: BrowserWindow | null = null;
let controlUrl = "";
let backend: EmulatorBackend;
let mode: ModeMachine;
let store: RunStore;
let currentRunId: string | null = null;
let layout: ReturnType<typeof appLayout>;

async function bootstrap() {
  layout = appLayout(app.getPath("userData"));
  store = new RunStore(layout.runs);
  mode = new ModeMachine();
  backend = new MockBackend();

  const server = await createControlServer(
    {
      mode,
      backend,
      getRunId: () => currentRunId,
      getSaveDir: () =>
        currentRunId ? layout.saves(currentRunId) : path.join(layout.root, "orphan-saves"),
    },
    { host: "127.0.0.1", port: 7946 }
  );
  controlUrl = server.url;

  ipcMain.handle("studio:getControlUrl", () => controlUrl);
  ipcMain.handle("studio:getPaths", () => layout);
  ipcMain.handle("studio:listRuns", () => store.list());
  ipcMain.handle("studio:pickRom", async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "GBA ROM", extensions: ["gba"] }],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle("studio:createRun", async (_e, romPath: string) => {
    const run = store.create({ rom_path: romPath });
    currentRunId = run.id;
    await backend.stop().catch(() => undefined);
    await backend.start(romPath);
    store.appendEvent(run.id, { type: "run_started" });
    return run;
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
    mode.set(next);
    if (currentRunId) {
      store.appendEvent(currentRunId, {
        type: `mode_${next}`,
      });
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
