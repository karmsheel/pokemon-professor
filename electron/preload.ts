import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
  restartHermesGateway: (override?: object) =>
    ipcRenderer.invoke("studio:restartHermesGateway", override) as Promise<{
      ok: boolean;
      message: string;
      cli?: string;
    }>,
  detectHermesEnv: () => ipcRenderer.invoke("studio:detectHermesEnv"),
  probeHermes: (override?: object) =>
    ipcRenderer.invoke("studio:probeHermes", override),
  probeHermesAcp: () => ipcRenderer.invoke("studio:probeHermesAcp"),

  listStudents: () => ipcRenderer.invoke("studio:listStudents"),
  setMetGa: (met: boolean) => ipcRenderer.invoke("studio:setMetGa", met),
  createStudent: (input: {
    name: string;
    avatar: "boy" | "girl";
    backstory?: string;
  }) => ipcRenderer.invoke("studio:createStudent", input),
  updateStudent: (
    id: string,
    patch: Partial<{ name: string; avatar: "boy" | "girl"; backstory: string }>
  ) => ipcRenderer.invoke("studio:updateStudent", id, patch),
  setActiveStudent: (id: string | null) =>
    ipcRenderer.invoke("studio:setActiveStudent", id),
  getGaThread: () => ipcRenderer.invoke("studio:getGaThread"),
  ensureGa: () => ipcRenderer.invoke("studio:ensureGa"),
  getStudentPlaySession: (studentId: string) =>
    ipcRenderer.invoke("studio:getStudentPlaySession", studentId),
  sendGaMessage: (text: string) =>
    ipcRenderer.invoke("studio:sendGaMessage", text),
  sendStudentMessage: (studentId: string, text: string) =>
    ipcRenderer.invoke("studio:sendStudentMessage", studentId, text),
  startStudentPlay: (
    studentId: string,
    opts?: { missionBrief?: string }
  ) => ipcRenderer.invoke("studio:startStudentPlay", studentId, opts),
  seedStudentIntro: (
    studentId: string,
    messages: Array<{ role: string; content: string }>
  ) => ipcRenderer.invoke("studio:seedStudentIntro", studentId, messages),
  completeStudentCutscene: (input: {
    name: string;
    avatar: "boy" | "girl";
    missionBrief: string;
    introMessages: Array<{ role: string; content: string }>;
  }) => ipcRenderer.invoke("studio:completeStudentCutscene", input),
  stopStudentPlay: () => ipcRenderer.invoke("studio:stopStudentPlay"),
  consumeProvisionalDiscardToast: () =>
    ipcRenderer.invoke("studio:consumeProvisionalDiscardToast") as Promise<{
      message: string;
    } | null>,

  onAgentEvent: (cb: (payload: unknown) => void) => {
    const handler = (_: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("studio:agentEvent", handler);
    return () => ipcRenderer.removeListener("studio:agentEvent", handler);
  },
  onFirstSavePromoted: (cb: (payload: unknown) => void) => {
    const handler = (_: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("studio:firstSavePromoted", handler);
    return () =>
      ipcRenderer.removeListener("studio:firstSavePromoted", handler);
  },
});
