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
      }>;
      ensureMgba: () => Promise<{
        ok: true;
        downloaded: boolean;
        path: string;
        backendKind: "mock" | "mgba";
      }>;
      createRun: (romPath: string) => Promise<{ id: string }>;
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
    };
  }
}
