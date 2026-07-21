import type { ModeMachine } from "./mode-machine";
import type { EmulatorBackend } from "../emulator/backend";
import type { CaptureScheduler } from "../emulator/capture-scheduler";

export interface ControlContext {
  mode: ModeMachine;
  backend: EmulatorBackend;
  capture: CaptureScheduler;
  getRunId: () => string | null;
  getSaveDir: () => string;
}
