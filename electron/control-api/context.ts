import type { ModeMachine } from "./mode-machine";
import type { EmulatorBackend } from "../emulator/backend";

export interface ControlContext {
  mode: ModeMachine;
  backend: EmulatorBackend;
  getRunId: () => string | null;
  getSaveDir: () => string;
}
