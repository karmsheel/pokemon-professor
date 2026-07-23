import type { Button, ControlMode } from "@/electron/control-api/types";

/**
 * Drive-mode keyboard map: physical keys → GBA buttons.
 * Arrow keys = D-pad, z/x = A/B, Enter = START, Shift = SELECT.
 * Escape is handled separately (returns to agent mode).
 */
export const DRIVE_KEY_MAP: Record<string, Button> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  z: "A",
  Z: "A",
  x: "B",
  X: "B",
  Enter: "START",
  Shift: "SELECT",
};

export type DriveKeyAction =
  | { kind: "driveInput"; button: Button }
  | { kind: "setMode"; mode: "agent" }
  | { kind: "none" };

/**
 * Resolve a keydown into a Drive action. Pure + mode-gated so the mapping can
 * be unit-tested without a DOM. Returns `none` when not in drive mode or the
 * key is unmapped. Escape in drive mode returns a `setMode` action (→ agent).
 */
export function resolveDriveKey(key: string, mode: ControlMode): DriveKeyAction {
  if (mode !== "drive") return { kind: "none" };
  if (key === "Escape") return { kind: "setMode", mode: "agent" };
  const button = DRIVE_KEY_MAP[key];
  if (button) return { kind: "driveInput", button };
  return { kind: "none" };
}
