export {};

declare global {
  interface Window {
    studio?: {
      getControlUrl: () => Promise<string>;
      getPaths: () => Promise<unknown>;
      getEmulatorInfo: () => Promise<{
        choice: "mock" | "mgba";
        backendKind: "mock" | "mgba";
        mgbaPresent: boolean;
        mgbaPath: string | null;
        scriptPath: string | null;
        env: string | null;
        bridgeUp: boolean;
        bridgePort: number | null;
        romLoaded: boolean;
      }>;
      ensureMgba: () => Promise<{
        ok: true;
        downloaded: boolean;
        path: string;
        backendKind: "mock" | "mgba";
      }>;
      createRun: (romPath: string) => Promise<{
        id: string;
        connect?: "attach" | "spawn" | "mock";
      }>;
      /** Create run, start/attach backend, set agent mode; ROM from arg or lastRomPath. */
      startGame: (romPath?: string | null) => Promise<{
        id: string;
        rom_path: string;
        connect: "attach" | "spawn" | "mock";
        mode: "agent";
      }>;
      /** Attach to running mGBA + Lua bridge (no second emulator window). */
      attachBridge: (romPath?: string | null) => Promise<{
        id: string;
        rom_path: string;
        connect: "attach";
      }>;
      listRuns: () => Promise<
        Array<{
          id: string;
          rom_path: string;
          created_at: string;
          status: string;
          savestates: string[];
        }>
      >;
      /** Resume an existing run: start backend with rom_path, load last savestate if any. */
      resumeRun: (runId: string) => Promise<{
        id: string;
        rom_path: string;
        loadedSavestate: string | null;
      }>;
      addMission: (runId: string, prompt: string) => Promise<unknown>;
      setMode: (mode: "agent" | "nudge" | "drive") => Promise<string>;
      save: (name: string) => Promise<unknown>;
      load: (name: string) => Promise<unknown>;
      pickRom: () => Promise<string | null>;
      /** Drive-mode only: bypasses agent POST /input gate. */
      driveInput: (buttons: string[]) => Promise<{ ok: true }>;
      getSettings: () => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      setHermesSettings: (partial: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      setLastRomPath: (romPath: string | null) => Promise<{
        hermes: { baseUrl: string; apiKey: string; model: string };
        lastRomPath: string | null;
      }>;
      openHermesDocs: () => Promise<void>;
      probeHermes: (override?: {
        baseUrl?: string;
        apiKey?: string;
        model?: string;
      }) => Promise<{ ok: boolean; error?: string; hint?: string }>;
    };
  }
}
