import { describe, expect, it } from "vitest";
import { DRIVE_KEY_MAP, resolveDriveKey } from "@/lib/drive-keys";

describe("resolveDriveKey (Drive-mode keyboard → GBA button)", () => {
  it("maps arrows to the D-pad in drive mode", () => {
    expect(resolveDriveKey("ArrowUp", "drive")).toEqual({
      kind: "driveInput",
      button: "UP",
    });
    expect(resolveDriveKey("ArrowDown", "drive")).toEqual({
      kind: "driveInput",
      button: "DOWN",
    });
    expect(resolveDriveKey("ArrowLeft", "drive")).toEqual({
      kind: "driveInput",
      button: "LEFT",
    });
    expect(resolveDriveKey("ArrowRight", "drive")).toEqual({
      kind: "driveInput",
      button: "RIGHT",
    });
  });

  it("maps z/x to A/B (case-insensitive) in drive mode", () => {
    expect(resolveDriveKey("z", "drive")).toEqual({ kind: "driveInput", button: "A" });
    expect(resolveDriveKey("Z", "drive")).toEqual({ kind: "driveInput", button: "A" });
    expect(resolveDriveKey("x", "drive")).toEqual({ kind: "driveInput", button: "B" });
    expect(resolveDriveKey("X", "drive")).toEqual({ kind: "driveInput", button: "B" });
  });

  it("maps Enter → START and Shift → SELECT in drive mode", () => {
    expect(resolveDriveKey("Enter", "drive")).toEqual({
      kind: "driveInput",
      button: "START",
    });
    expect(resolveDriveKey("Shift", "drive")).toEqual({
      kind: "driveInput",
      button: "SELECT",
    });
  });

  it("maps Escape → return to agent in drive mode", () => {
    expect(resolveDriveKey("Escape", "drive")).toEqual({
      kind: "setMode",
      mode: "agent",
    });
  });

  it("returns none for unmapped keys in drive mode", () => {
    expect(resolveDriveKey("q", "drive")).toEqual({ kind: "none" });
    expect(resolveDriveKey("a", "drive")).toEqual({ kind: "none" });
    expect(resolveDriveKey("Tab", "drive")).toEqual({ kind: "none" });
  });

  it("returns none for any key when not in drive mode (agent/nudge gate)", () => {
    expect(resolveDriveKey("ArrowRight", "agent")).toEqual({ kind: "none" });
    expect(resolveDriveKey("ArrowRight", "nudge")).toEqual({ kind: "none" });
    expect(resolveDriveKey("Escape", "nudge")).toEqual({ kind: "none" });
    expect(resolveDriveKey("z", "agent")).toEqual({ kind: "none" });
  });

  it("exposes the full expected key map", () => {
    expect(DRIVE_KEY_MAP).toMatchObject({
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
    });
  });
});
