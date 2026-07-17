import type { ControlMode } from "./types";

export class ModeMachine {
  private mode: ControlMode = "agent";

  get(): ControlMode {
    return this.mode;
  }

  set(mode: ControlMode): void {
    this.mode = mode;
  }

  assertAgent(): void {
    if (this.mode !== "agent") {
      throw new Error(`input blocked: mode is ${this.mode}`);
    }
  }
}
