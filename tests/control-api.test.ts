import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { createControlServer } from "../electron/control-api/server";
import { ModeMachine } from "../electron/control-api/mode-machine";
import { MockBackend } from "../electron/emulator/mock-backend";
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
    ctx = {
      mode: new ModeMachine(),
      backend,
      getRunId: () => "run-test-1",
      getSaveDir: () => path.join(tmp, "saves"),
    };
    const server = await createControlServer(ctx, { host: "127.0.0.1", port: 0 });
    base = server.url;
    close = server.close;
  });

  afterAll(async () => {
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

  it("GET /state returns null state in alpha", async () => {
    const { status, body } = await json(`${base}/state`);
    expect(status).toBe(200);
    expect(body.state).toBeNull();
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
