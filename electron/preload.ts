import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("studio", {
  getControlUrl: () => ipcRenderer.invoke("studio:getControlUrl") as Promise<string>,
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
  getEmulatorInfo: () =>
    ipcRenderer.invoke("studio:getEmulatorInfo") as Promise<{
      choice: "mock" | "mgba";
      backendKind: "mock" | "mgba";
      mgbaPresent: boolean;
      mgbaPath: string | null;
      scriptPath: string | null;
      env: string | null;
      bridgeUp: boolean;
      bridgePort: number | null;
      romLoaded: boolean;
    }>,
  ensureMgba: () =>
    ipcRenderer.invoke("studio:ensureMgba") as Promise<{
      ok: true;
      downloaded: boolean;
      path: string;
      backendKind: "mock" | "mgba";
    }>,
  createRun: (romPath: string) =>
    ipcRenderer.invoke("studio:createRun", romPath) as Promise<{
      id: string;
      connect?: "attach" | "spawn" | "mock";
    }>,
  startGame: (romPath?: string | null) =>
    ipcRenderer.invoke("studio:startGame", romPath) as Promise<{
      id: string;
      rom_path: string;
      connect: "attach" | "spawn" | "mock";
      mode: "agent";
    }>,
  attachBridge: (romPath?: string | null) =>
    ipcRenderer.invoke("studio:attachBridge", romPath) as Promise<{
      id: string;
      rom_path: string;
      connect: "attach";
    }>,
  listRuns: () =>
    ipcRenderer.invoke("studio:listRuns") as Promise<
      Array<{
        id: string;
        rom_path: string;
        created_at: string;
        status: string;
        savestates: string[];
      }>
    >,
  resumeRun: (runId: string) =>
    ipcRenderer.invoke("studio:resumeRun", runId) as Promise<{
      id: string;
      rom_path: string;
      loadedSavestate: string | null;
    }>,
  addMission: (runId: string, prompt: string) =>
    ipcRenderer.invoke("studio:addMission", runId, prompt),
  setMode: (mode: "agent" | "nudge" | "drive") =>
    ipcRenderer.invoke("studio:setMode", mode),
  save: (name: string) => ipcRenderer.invoke("studio:save", name),
  load: (name: string) => ipcRenderer.invoke("studio:load", name),
  pickRom: () => ipcRenderer.invoke("studio:pickRom") as Promise<string | null>,
  driveInput: (buttons: string[]) =>
    ipcRenderer.invoke("studio:driveInput", buttons) as Promise<{ ok: true }>,
  getSettings: () => ipcRenderer.invoke("studio:getSettings"),
  setHermesSettings: (partial: object) =>
    ipcRenderer.invoke("studio:setHermesSettings", partial),
  setLastRomPath: (romPath: string | null) =>
    ipcRenderer.invoke("studio:setLastRomPath", romPath),
  openHermesDocs: () => ipcRenderer.invoke("studio:openHermesDocs"),
  probeHermes: (override?: object) =>
    ipcRenderer.invoke("studio:probeHermes", override),
});
