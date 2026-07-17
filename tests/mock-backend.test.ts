import { describe, it, expect, beforeEach } from "vitest";
import { MockBackend } from "../electron/emulator/mock-backend";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("MockBackend", () => {
  let backend: MockBackend;
  let tmp: string;

  beforeEach(async () => {
    backend = new MockBackend();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mock-"));
  });

  it("starts unloaded", () => {
    expect(backend.isRomLoaded()).toBe(false);
    expect(backend.kind).toBe("mock");
  });

  it("loads rom and returns a PNG frame", async () => {
    await backend.start(path.join(tmp, "firered.gba"));
    expect(backend.isRomLoaded()).toBe(true);
    const frame = await backend.getFramePng();
    expect(frame.width).toBe(240);
    expect(frame.height).toBe(160);
    expect(frame.data[0]).toBe(0x89); // PNG magic
    expect(frame.frame_id).toBeGreaterThanOrEqual(0);
  });

  it("accepts presses and increments frame_id", async () => {
    await backend.start("x.gba");
    const a = await backend.getFramePng();
    await backend.press(["RIGHT", "A"]);
    const b = await backend.getFramePng();
    expect(b.frame_id).toBeGreaterThan(a.frame_id);
  });

  it("save and load state round-trip", async () => {
    await backend.start("x.gba");
    await backend.press(["UP"]);
    const before = await backend.getFramePng();
    const savePath = await backend.saveState("before_brock", tmp);
    expect(fs.existsSync(savePath)).toBe(true);
    await backend.press(["DOWN", "DOWN"]);
    const mid = await backend.getFramePng();
    expect(mid.frame_id).toBeGreaterThan(before.frame_id);
    await backend.loadState("before_brock", tmp);
    const after = await backend.getFramePng();
    expect(after.frame_id).toBe(before.frame_id);
    const saves = await backend.listSaves(tmp);
    expect(saves).toContain("before_brock");
  });

  it("getState returns stub null party shape for alpha", async () => {
    await backend.start("x.gba");
    const state = await backend.getState();
    expect(state).toEqual(null);
  });
});
