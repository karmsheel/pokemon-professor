/**
 * Contract test: Hermes skill protocol against real Control API + MockBackend.
 *
 * Documents the skill loop from skills/pokemon-professor/SKILL.md:
 *   observe (GET /state, GET /frame) → POST /input
 *   → human nudge → POST /input 409
 *   → resume agent → POST /input 200
 *
 * Locks the skill HTTP expectations to server behavior (API 0.1.0).
 */
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

describe("Pokemon Professor skill protocol", () => {
  let base: string;
  let close: () => Promise<void>;
  let tmp: string;
  let capture: CaptureScheduler;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-skill-"));
    const backend = new MockBackend();
    await backend.start(path.join(tmp, "firered.gba"));
    let ctx: ControlContext;
    capture = new CaptureScheduler(() => ctx.backend);
    ctx = {
      mode: new ModeMachine(),
      backend,
      capture,
      getRunId: () => "run-skill-1",
      getSaveDir: () => path.join(tmp, "saves"),
    };
    capture.start();
    for (let i = 0; i < 50 && !capture.getLatest(); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const server = await createControlServer(ctx, { host: "127.0.0.1", port: 0 });
    base = server.url;
    close = server.close;
  });

  afterAll(async () => {
    capture.stop();
    await close();
  });

  it("observe → input → nudge 409 → resume → input", async () => {
    // --- OBSERVE (skill step 1) ---
    const state = await json(`${base}/state`);
    expect(state.status).toBe(200);
    expect(state.body).toHaveProperty("state");

    const frame = await json(`${base}/frame`);
    expect(frame.status).toBe(200);
    expect(frame.body.mime).toBe("image/png");
    expect(typeof frame.body.data).toBe("string");
    expect(frame.body.data.length).toBeGreaterThan(0);
    expect(frame.body.width).toBe(240);

    // Health check used by skill preconditions
    const health = await json(`${base}/health`);
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.api_version).toBe("0.1.0");
    expect(health.body.mode).toBe("agent");
    expect(health.body.rom_loaded).toBe(true);

    // --- ACT (skill step 4): short button sequence, max 5 ---
    const act = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["UP", "RIGHT", "A"] }),
    });
    expect(act.status).toBe(200);
    expect(act.body.ok).toBe(true);
    expect(act.body.executed).toEqual(["UP", "RIGHT", "A"]);
    expect(act.body.mode).toBe("agent");

    // --- NUDGE: human freezes agent tools ---
    const nudge = await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "nudge" }),
    });
    expect(nudge.status).toBe(200);
    expect(nudge.body.mode).toBe("nudge");

    // Skill must get 409 and wait (do not keep acting)
    const blocked = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.ok).toBe(false);
    expect(blocked.body.mode).toBe("nudge");

    // --- RESUME: back to agent ---
    const resume = await json(`${base}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "agent" }),
    });
    expect(resume.status).toBe(200);
    expect(resume.body.mode).toBe("agent");

    // --- ACT again after resume ---
    const after = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["LEFT"] }),
    });
    expect(after.status).toBe(200);
    expect(after.body.ok).toBe(true);
    expect(after.body.executed).toEqual(["LEFT"]);
    expect(after.body.mode).toBe("agent");
  });

  it("rejects more than 5 buttons (skill max)", async () => {
    const { status, body } = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        buttons: ["A", "B", "UP", "DOWN", "LEFT", "RIGHT"],
      }),
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });
});
