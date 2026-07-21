import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { MockBackend } from "../electron/emulator/mock-backend";
import { CaptureScheduler } from "../electron/emulator/capture-scheduler";

describe("CaptureScheduler", () => {
  let backend: MockBackend;
  let sched: CaptureScheduler;
  let tmp: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-cap-"));
    backend = new MockBackend();
    await backend.start(path.join(tmp, "rom.gba"));
    sched = new CaptureScheduler(() => backend);
  });

  afterEach(() => {
    sched.stop();
  });

  it("GET-style reads do not capture; force does", async () => {
    expect(sched.getLatest()).toBeNull();
    expect(sched.getCaptureCount()).toBe(0);
    const f = await sched.forceCapture();
    expect(f.width).toBe(240);
    expect(sched.getLatest()?.frame_id).toBe(f.frame_id);
    expect(sched.getCaptureCount()).toBe(1);
    // buffer read does not call backend again
    expect(sched.getLatest()?.frame_id).toBe(f.frame_id);
    expect(sched.getCaptureCount()).toBe(1);
  });

  it("live loop fills latest without force", async () => {
    sched.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(sched.getLatest()).not.toBeNull();
    expect(sched.getCaptureCount()).toBeGreaterThanOrEqual(1);
    const n = sched.getCaptureCount();
    await new Promise((r) => setTimeout(r, 80));
    expect(sched.getCaptureCount()).toBeGreaterThanOrEqual(n);
  });

  it("failed force does not clear latest", async () => {
    await sched.forceCapture();
    const id = sched.getLatest()!.frame_id;
    await backend.stop();
    await expect(sched.forceCapture()).rejects.toThrow();
    // restart backend for cleanup path; latest should still hold old if we re-load without start clear
    // After stop of backend only, scheduler still holds buffer:
    expect(sched.getLatest()?.frame_id).toBe(id);
  });

  it("setIntervalMs clamps and rejects bad values", () => {
    expect(() => sched.setIntervalMs(-1)).toThrow();
    expect(() => sched.setIntervalMs(10)).toThrow();
    sched.setIntervalMs(0);
    expect(sched.getIntervalMs()).toBe(0);
    sched.setIntervalMs(50);
    expect(sched.getIntervalMs()).toBe(50);
    sched.setIntervalMs(10000);
    expect(sched.getIntervalMs()).toBe(10000);
    expect(() => sched.setIntervalMs(10001)).toThrow();
  });

  it("start resets interval_ms to 0", () => {
    sched.setIntervalMs(200);
    sched.start();
    expect(sched.getIntervalMs()).toBe(0);
  });

  it("stop clears latest", async () => {
    await sched.forceCapture();
    sched.stop();
    expect(sched.getLatest()).toBeNull();
    expect(sched.isRunning()).toBe(false);
  });
});
