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
    }>,
  ensureMgba: () =>
    ipcRenderer.invoke("studio:ensureMgba") as Promise<{
      ok: true;
      downloaded: boolean;
      path: string;
      backendKind: "mock" | "mgba";
    }>,
  createRun: (romPath: string) =>
    ipcRenderer.invoke("studio:createRun", romPath),
  listRuns: () => ipcRenderer.invoke("studio:listRuns"),
  addMission: (runId: string, prompt: string) =>
    ipcRenderer.invoke("studio:addMission", runId, prompt),
  setMode: (mode: "agent" | "nudge" | "drive") =>
    ipcRenderer.invoke("studio:setMode", mode),
  save: (name: string) => ipcRenderer.invoke("studio:save", name),
  load: (name: string) => ipcRenderer.invoke("studio:load", name),
  pickRom: () => ipcRenderer.invoke("studio:pickRom") as Promise<string | null>,
  driveInput: (buttons: string[]) =>
    ipcRenderer.invoke("studio:driveInput", buttons) as Promise<{ ok: true }>,
});
