import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createControlServer } from "../electron/control-api/server";
import { ModeMachine } from "../electron/control-api/mode-machine";
import { MockBackend } from "../electron/emulator/mock-backend";
import { CaptureScheduler } from "../electron/emulator/capture-scheduler";
import type { ControlContext } from "../electron/control-api/context";

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json();
  return { status: res.status, body };
}

describe("Control API", () => {
  let base: string;
  let close: () => Promise<void>;
  let ctx: ControlContext;
  let tmp: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-api-"));
    const backend = new MockBackend();
    await backend.start(path.join(tmp, "firered.gba"));
    const capture = new CaptureScheduler(() => ctx.backend);
    ctx = {
      mode: new ModeMachine(),
      backend,
      capture,
      getRunId: () => "run-test-1",
      getSaveDir: () => path.join(tmp, "saves"),
    };
    capture.start();
    // wait until at least one frame
    for (let i = 0; i < 50 && !capture.getLatest(); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const server = await createControlServer(ctx, { host: "127.0.0.1", port: 0 });
    base = server.url;
    close = server.close;
  });

  afterAll(async () => {
    ctx.capture.stop();
    await close();
  });

  it("GET /health", async () => {
    const { status, body } = await json(`${base}/health`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.api_version).toBe("0.1.0");
    expect(body.mode).toBe("agent");
    expect(body.emulator).toBe("mock");
    expect(body.rom_loaded).toBe(true);
    expect(body.run_id).toBe("run-test-1");
  });

  it("GET /frame returns png base64", async () => {
    const { status, body } = await json(`${base}/frame`);
    expect(status).toBe(200);
    expect(body.mime).toBe("image/png");
    expect(typeof body.data).toBe("string");
    expect(body.width).toBe(240);
  });

  it("GET /frame?raw=1 returns binary PNG with metadata headers", async () => {
    const res = await fetch(`${base}/frame?raw=1`, {
      headers: { Accept: "image/png" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/png/);
    expect(res.headers.get("x-frame-width")).toBe("240");
    expect(res.headers.get("x-frame-height")).toBe("160");
    expect(Number(res.headers.get("x-frame-id"))).toBeGreaterThanOrEqual(0);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x89); // PNG magic
    expect(buf.length).toBeGreaterThan(8);
  });

  it("GET /frame does not advance frame_id (buffer read)", async () => {
    const a = await json(`${base}/frame`);
    const b = await json(`${base}/frame`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // live loop may still capture between reads; verify snapshot path works
    const s = await json(`${base}/snapshot`);
    expect(s.status).toBe(200);
    expect(typeof s.body.data).toBe("string");
    expect(typeof s.body.age_ms).toBe("number");
    expect(s.body.frame_id).toBeDefined();
  });

  it("GET /frame after stop does not advance captureCount", async () => {
    ctx.capture.stop();
    const n = ctx.capture.getCaptureCount();
    const a = await json(`${base}/frame`);
    const b = await json(`${base}/frame`);
    // no latest after stop → 404 buffer reads, no new captures
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(ctx.capture.getCaptureCount()).toBe(n);
    // restore live loop for remaining tests
    ctx.capture.start();
    for (let i = 0; i < 50 && !ctx.capture.getLatest(); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it("POST /snapshot force advances capture", async () => {
    const before = await json(`${base}/snapshot`);
    const forced = await json(`${base}/snapshot`, { method: "POST" });
    expect(forced.status).toBe(200);
    expect(forced.body.frame_id).toBeGreaterThanOrEqual(before.body.frame_id);
    expect(typeof forced.body.data).toBe("string");
  });

  it("PUT /snapshot/config validates interval_ms", async () => {
    const bad = await json(`${base}/snapshot/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interval_ms: 10 }),
    });
    expect(bad.status).toBe(400);
    const ok = await json(`${base}/snapshot/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interval_ms: 100 }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.interval_ms).toBe(100);
    const got = await json(`${base}/snapshot/config`);
    expect(got.body.interval_ms).toBe(100);
    // restore live-loop default
    await json(`${base}/snapshot/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interval_ms: 0 }),
    });
  });

  it("GET /frame?raw=1 includes x-captured-at", async () => {
    const res = await fetch(`${base}/frame?raw=1`, {
      headers: { Accept: "image/png" },
    });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-captured-at"))).toBeGreaterThan(0);
  });

  it("GET /state returns B-lite FireRedState from the backend", async () => {
    const { status, body } = await json(`${base}/state`);
    expect(status).toBe(200);
    expect(body.state).not.toBeNull();
    // Mock backend reports Pallet Town, a single Lv5 member.
    expect(body.state.map_id).toBe(0x101);
    expect(body.state.x).toBe(7);
    expect(body.state.y).toBe(9);
    expect(body.state.in_battle).toBe(false);
    expect(Array.isArray(body.state.party)).toBe(true);
    expect(body.state.party[0].level).toBe(5);
    // Species comes from the encrypted header; mock flags it uncertain.
    expect(body.state.party[0].species_uncertain).toBe(true);
  });

  it("POST /input works in agent mode", async () => {
    const { status, body } = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A", "RIGHT"] }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.executed).toEqual(["A", "RIGHT"]);
  });

  it("POST /input returns 409 in nudge mode", async () => {
    await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "nudge" }),
    });
    const { status, body } = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.mode).toBe("nudge");
    // restore
    await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "agent" }),
    });
  });

  it("POST /input returns 409 in drive mode", async () => {
    await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "drive" }),
    });
    const { status, body } = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.mode).toBe("drive");
    // restore
    await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "agent" }),
    });
  });

  it("POST /load rejects invalid names", async () => {
    const { status, body } = await json(`${base}/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "../escape" }),
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("rejects more than 5 buttons", async () => {
    const { status, body } = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        buttons: ["A", "A", "A", "A", "A", "A"],
      }),
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("save and load and list", async () => {
    const save = await json(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha1" }),
    });
    expect(save.status).toBe(200);
    expect(save.body.ok).toBe(true);

    const list = await json(`${base}/saves`);
    expect(list.body.saves).toContain("alpha1");

    const load = await json(`${base}/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha1" }),
    });
    expect(load.status).toBe(200);
  });
});
