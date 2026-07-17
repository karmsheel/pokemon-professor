export {};

declare global {
  interface Window {
    studio?: {
      getControlUrl: () => Promise<string>;
      getPaths: () => Promise<unknown>;
      createRun: (romPath: string) => Promise<{ id: string }>;
      listRuns: () => Promise<unknown[]>;
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
