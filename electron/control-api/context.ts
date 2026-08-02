import type { ModeMachine } from "./mode-machine";
import type { EmulatorBackend } from "../emulator/backend";
import type { CaptureScheduler } from "../emulator/capture-scheduler";
import type { ControlActivityTracker } from "./activity";

export interface ControlContext {
  mode: ModeMachine;
  backend: EmulatorBackend;
  capture: CaptureScheduler;
  getRunId: () => string | null;
  getSaveDir: () => string;
  /** Optional activity tracker for play-loop hard-checks. */
  activity?: ControlActivityTracker;
  /**
   * Optional run-starter used by the headless E2E (POST /run). Mirrors the
   * studio:createRun IPC handler: creates a run, starts/attaches the backend
   * with the ROM, and begins capture. Set by main bootstrap.
   */
  startRun?: (romPath: string) => Promise<{ id: string; connect: "attach" | "spawn" | "mock" }>;
}
