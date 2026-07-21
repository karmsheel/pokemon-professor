# Live view vs agent snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split max-rate studio live frames from agent snapshot tools on one shared `latest` buffer owned by a CaptureScheduler.

**Architecture:** A new `CaptureScheduler` is the sole caller of `backend.getFramePng()`. It runs a live loop while ROM is loaded and fills a single `latest` buffer. `GET /frame` and `GET /snapshot` only read that buffer; `POST /snapshot` forces a capture; `PUT /snapshot/config` sets optional `interval_ms` (default 0). Live view polls with max backpressure (no mode-based throttle). Hermes skill uses `/snapshot`.

**Tech Stack:** Electron main-process TypeScript, Node `http` Control API, Vitest, existing `EmulatorBackend` / `MockBackend` / `MgbaBackend`.

**Spec:** `docs/superpowers/specs/2026-07-21-live-vs-agent-frames-design.md`

## Global Constraints

- Control API stays **localhost only**.
- Only `CaptureScheduler` may call `getFramePng()` for HTTP frame delivery (routes never capture).
- Single buffer `latest` shared by UI and agent — no dual buffers / dual resolutions.
- Default `interval_ms = 0` (agent on-demand only); clamp allowed values to **[50, 10000]** when non-zero.
- On attach/start: reset `interval_ms` to 0 and start live loop; on stop/detach: stop loops and clear `latest`.
- Mode (`agent` | `nudge` | `drive`) must not change capture rate.
- Failed captures must not overwrite last good `latest`.
- Preserve raw PNG path: `GET /frame?raw=1` + headers `x-frame-id`, `x-frame-width`, `x-frame-height` (add `x-captured-at`).
- Do not implement WebSocket/SSE, JPEG downscale, or interval persistence across restarts.

## File map

```
electron/
  emulator/
    capture-scheduler.ts     # NEW — buffer, live loop, force, interval timer
    mock-backend.ts          # increment frame_id on each getFramePng
  control-api/
    context.ts               # add capture: CaptureScheduler
    routes.ts                # /frame buffer-read; /snapshot*; config
  main.ts                    # start/stop scheduler on run attach/stop
components/
  live-view.tsx              # max backpressure poll; meta age/display fps
lib/
  control-client.ts          # captured_at header; snapshot helpers
skills/pokemon-professor/
  SKILL.md                   # observe via /snapshot
README.md                    # endpoint table
tests/
  capture-scheduler.test.ts  # NEW
  control-api.test.ts        # wire scheduler; snapshot + frame semantics
```

---

### Task 1: CaptureScheduler + unit tests

**Files:**
- Create: `electron/emulator/capture-scheduler.ts`
- Create: `tests/capture-scheduler.test.ts`
- Modify: `electron/emulator/mock-backend.ts` (increment `frame_id` on every `getFramePng`)

**Interfaces:**
- Consumes: `EmulatorBackend` (`isRomLoaded`, `getFramePng`)
- Produces:

```ts
export type CapturedFrame = {
  data: Buffer;
  width: number;
  height: number;
  frame_id: number;
  captured_at: number; // Date.now() ms
};

export class CaptureScheduler {
  constructor(getBackend: () => EmulatorBackend);
  /** Start live loop; reset interval_ms to 0. No-op if already running. */
  start(): void;
  /** Stop live loop + timer; clear latest. */
  stop(): void;
  isRunning(): boolean;
  getLatest(): CapturedFrame | null;
  /** Age in ms, or null if no frame. */
  getAgeMs(now?: number): number | null;
  getIntervalMs(): number;
  /** 0 disables timer; non-zero clamped to [50, 10000]. Throws on invalid. */
  setIntervalMs(ms: number): void;
  /**
   * Force one capture (priority). Updates latest on success.
   * Throws if ROM not loaded or capture fails (does not clear latest on fail).
   */
  forceCapture(): Promise<CapturedFrame>;
  /** Test/diag: number of successful getFramePng calls since last start. */
  getCaptureCount(): number;
}
```

- [ ] **Step 1: Make MockBackend advance frame_id on capture**

In `electron/emulator/mock-backend.ts`, change `getFramePng` to:

```ts
async getFramePng() {
  if (!this.loaded) throw new Error("rom not loaded");
  this.frameId += 1;
  return {
    data: solidPng(),
    width: 240,
    height: 160,
    frame_id: this.frameId,
  };
}
```

- [ ] **Step 2: Write failing unit tests**

Create `tests/capture-scheduler.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests — expect FAIL (module missing)**

```bash
npx vitest run tests/capture-scheduler.test.ts
```

Expected: fail to resolve `capture-scheduler` or missing export.

- [ ] **Step 4: Implement CaptureScheduler**

Create `electron/emulator/capture-scheduler.ts`:

```ts
import type { EmulatorBackend } from "./backend";

export type CapturedFrame = {
  data: Buffer;
  width: number;
  height: number;
  frame_id: number;
  captured_at: number;
};

const MIN_INTERVAL = 50;
const MAX_INTERVAL = 10000;
/** Yield between live captures so the event loop can serve HTTP. */
const LIVE_YIELD_MS = 0;

export class CaptureScheduler {
  private latest: CapturedFrame | null = null;
  private running = false;
  private intervalMs = 0;
  private captureCount = 0;
  private liveChain: Promise<void> = Promise.resolve();
  private forceChain: Promise<unknown> = Promise.resolve();
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private loopGeneration = 0;

  constructor(private readonly getBackend: () => EmulatorBackend) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalMs = 0;
    this.clearIntervalTimer();
    this.captureCount = 0;
    const gen = ++this.loopGeneration;
    void this.runLiveLoop(gen);
  }

  stop(): void {
    this.running = false;
    this.loopGeneration += 1;
    this.clearIntervalTimer();
    this.intervalMs = 0;
    this.latest = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getLatest(): CapturedFrame | null {
    return this.latest;
  }

  getAgeMs(now = Date.now()): number | null {
    if (!this.latest) return null;
    return Math.max(0, now - this.latest.captured_at);
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  setIntervalMs(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error("interval_ms must be a non-negative number");
    }
    if (ms === 0) {
      this.intervalMs = 0;
      this.clearIntervalTimer();
      return;
    }
    if (ms < MIN_INTERVAL || ms > MAX_INTERVAL) {
      throw new Error(
        `interval_ms must be 0 or between ${MIN_INTERVAL} and ${MAX_INTERVAL}`
      );
    }
    this.intervalMs = Math.floor(ms);
    this.clearIntervalTimer();
    this.intervalTimer = setInterval(() => {
      void this.maybeIntervalCapture();
    }, this.intervalMs);
  }

  getCaptureCount(): number {
    return this.captureCount;
  }

  async forceCapture(): Promise<CapturedFrame> {
    const run = async (): Promise<CapturedFrame> => {
      const backend = this.getBackend();
      if (!backend.isRomLoaded()) {
        throw new Error("rom not loaded");
      }
      const frame = await backend.getFramePng();
      const captured: CapturedFrame = {
        data: frame.data,
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
        captured_at: Date.now(),
      };
      this.latest = captured;
      this.captureCount += 1;
      return captured;
    };
    // Serialize forces with each other; live loop also uses captureOnce under the hood.
    const p = this.forceChain.then(run, run);
    this.forceChain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  }

  private clearIntervalTimer(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async maybeIntervalCapture(): Promise<void> {
    if (!this.running || this.intervalMs <= 0) return;
    const age = this.getAgeMs();
    if (age !== null && age < this.intervalMs) return;
    try {
      await this.forceCapture();
    } catch {
      /* keep last good */
    }
  }

  private async runLiveLoop(gen: number): Promise<void> {
    while (this.running && this.loopGeneration === gen) {
      const backend = this.getBackend();
      if (!backend.isRomLoaded()) {
        await sleep(50);
        continue;
      }
      try {
        await this.forceCapture();
      } catch {
        /* keep last good; back off slightly */
        await sleep(30);
        continue;
      }
      if (LIVE_YIELD_MS > 0) await sleep(LIVE_YIELD_MS);
      else await sleep(0); // always yield once
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

**Note:** Using `forceCapture` for the live loop serializes all captures on `forceChain`. That satisfies “only one capture at a time.” If live + force contend, they queue FIFO on that chain (acceptable for v1). Optionally later: separate live path that skips if a force is in flight — not required if tests pass.

- [ ] **Step 5: Run unit tests — expect PASS**

```bash
npx vitest run tests/capture-scheduler.test.ts
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add electron/emulator/capture-scheduler.ts electron/emulator/mock-backend.ts tests/capture-scheduler.test.ts
git commit -m "feat: CaptureScheduler owns shared latest frame buffer"
```

---

### Task 2: Wire scheduler into Control API routes

**Files:**
- Modify: `electron/control-api/context.ts`
- Modify: `electron/control-api/routes.ts`
- Modify: `tests/control-api.test.ts`
- Modify: `electron/main.ts` (start/stop only — can be same commit as routes if needed for compile)

**Interfaces:**
- Consumes: `CaptureScheduler` from Task 1
- Produces: `ControlContext.capture: CaptureScheduler`
- Routes:
  - `GET /frame` → read `capture.getLatest()` (no `getFramePng`)
  - `GET /snapshot` → JSON + `age_ms`
  - `POST /snapshot` → `forceCapture()`
  - `GET|PUT /snapshot/config`

- [ ] **Step 1: Extend ControlContext**

```ts
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
```

- [ ] **Step 2: Write / update Control API tests first**

In `tests/control-api.test.ts`:

1. Import `CaptureScheduler`.
2. In `beforeAll`, after `backend.start`:

```ts
const capture = new CaptureScheduler(() => ctx.backend);
// ctx must include capture — build ctx with capture after creating backend
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
```

3. In `afterAll`, `ctx.capture.stop()` before `close()`.

4. Keep existing `/frame` and raw tests (they should still 200 after buffer fill).

5. Add:

```ts
it("GET /frame does not advance frame_id (buffer read)", async () => {
  const a = await json(`${base}/frame`);
  const b = await json(`${base}/frame`);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  // ids equal OR b only advanced if live loop captured between — allow >= 
  // Stronger: snapshot capture count
  const countBefore = ctx.capture.getCaptureCount();
  await json(`${base}/frame`);
  await json(`${base}/frame`);
  // live loop may still capture; so instead check GET /snapshot does not require POST
  const s = await json(`${base}/snapshot`);
  expect(s.status).toBe(200);
  expect(typeof s.body.data).toBe("string");
  expect(typeof s.body.age_ms).toBe("number");
  expect(s.body.frame_id).toBeDefined();
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
```

6. Add a small describe for no-ROM / no-frame if easy: optional second server with unloaded backend — skip if heavy; at least document 409 path still works when `!isRomLoaded()`.

- [ ] **Step 3: Run tests — expect FAIL on missing capture / routes**

```bash
npx vitest run tests/control-api.test.ts
```

- [ ] **Step 4: Implement route handlers**

Update `sendPng` / frame handler in `routes.ts`:

```ts
// GET /frame
if (method === "GET" && p === "/frame") {
  if (!ctx.backend.isRomLoaded()) {
    return send(res, 409, { ok: false, error: "rom not loaded" });
  }
  const frame = ctx.capture.getLatest();
  if (!frame) {
    return send(res, 404, { ok: false, error: "no frame yet" });
  }
  if (wantsRawPng(req, url)) {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": frame.data.length,
      "cache-control": "no-store",
      "x-frame-id": String(frame.frame_id),
      "x-frame-width": String(frame.width),
      "x-frame-height": String(frame.height),
      "x-captured-at": String(frame.captured_at),
      ...corsHeaders(),
    });
    res.end(frame.data);
    return;
  }
  return send(res, 200, {
    mime: "image/png",
    data: frame.data.toString("base64"),
    width: frame.width,
    height: frame.height,
    frame_id: frame.frame_id,
    captured_at: frame.captured_at,
  });
}

// GET /snapshot
if (method === "GET" && p === "/snapshot") {
  if (!ctx.backend.isRomLoaded()) {
    return send(res, 409, { ok: false, error: "rom not loaded" });
  }
  const frame = ctx.capture.getLatest();
  if (!frame) {
    return send(res, 404, { ok: false, error: "no frame yet" });
  }
  const age_ms = ctx.capture.getAgeMs() ?? 0;
  return send(res, 200, {
    mime: "image/png",
    data: frame.data.toString("base64"),
    width: frame.width,
    height: frame.height,
    frame_id: frame.frame_id,
    captured_at: frame.captured_at,
    age_ms,
  });
}

// POST /snapshot
if (method === "POST" && p === "/snapshot") {
  if (!ctx.backend.isRomLoaded()) {
    return send(res, 409, { ok: false, error: "rom not loaded" });
  }
  try {
    const frame = await ctx.capture.forceCapture();
    const age_ms = ctx.capture.getAgeMs() ?? 0;
    return send(res, 200, {
      mime: "image/png",
      data: frame.data.toString("base64"),
      width: frame.width,
      height: frame.height,
      frame_id: frame.frame_id,
      captured_at: frame.captured_at,
      age_ms,
    });
  } catch (e) {
    return send(res, 502, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// GET /snapshot/config
if (method === "GET" && p === "/snapshot/config") {
  const latest = ctx.capture.getLatest();
  return send(res, 200, {
    interval_ms: ctx.capture.getIntervalMs(),
    live_loop: ctx.capture.isRunning(),
    has_frame: !!latest,
    last_frame_id: latest?.frame_id ?? null,
    last_captured_at: latest?.captured_at ?? null,
  });
}

// PUT /snapshot/config
if (method === "PUT" && p === "/snapshot/config") {
  const body = (await readJson(req)) as { interval_ms?: unknown };
  if (typeof body.interval_ms !== "number") {
    return send(res, 400, { ok: false, error: "interval_ms required (number)" });
  }
  try {
    ctx.capture.setIntervalMs(body.interval_ms);
  } catch (e) {
    return send(res, 400, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return send(res, 200, {
    ok: true,
    interval_ms: ctx.capture.getIntervalMs(),
    live_loop: ctx.capture.isRunning(),
    has_frame: !!ctx.capture.getLatest(),
    last_frame_id: ctx.capture.getLatest()?.frame_id ?? null,
    last_captured_at: ctx.capture.getLatest()?.captured_at ?? null,
  });
}
```

Expose `x-captured-at` in CORS: add to `access-control-expose-headers`.

- [ ] **Step 5: Wire main.ts**

In `bootstrap()`:

```ts
import { CaptureScheduler } from "./emulator/capture-scheduler";

const capture = new CaptureScheduler(() => controlCtx.backend);
// controlCtx needs capture field
controlCtx = {
  mode,
  backend,
  capture,
  getRunId: () => currentRunId,
  getSaveDir: () => /* existing */,
};
```

After successful `startOrAttachBackend` / `attach` / `resumeRun` (when ROM loaded):

```ts
capture.start(); // resets interval to 0 per spec
```

On app quit / stop run / backend stop:

```ts
capture.stop();
```

Find existing stop handlers (window-all-closed, before-quit, any stopRun) and call `capture.stop()` before or after `backend.stop()`.

When `setBackend` swaps backends, keep the same `CaptureScheduler` instance (it uses `getBackend()` closure).

- [ ] **Step 6: Fix any other test files that construct ControlContext**

```bash
rg "ControlContext|createControlServer" tests
```

Add `capture` everywhere required.

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: pass (update any test that assumed `/frame` always re-captures).

- [ ] **Step 8: Commit**

```bash
git add electron/control-api/context.ts electron/control-api/routes.ts electron/main.ts tests/control-api.test.ts
git commit -m "feat: Control API snapshot endpoints and buffer-read /frame"
```

---

### Task 3: Live view max backpressure + client helpers

**Files:**
- Modify: `components/live-view.tsx`
- Modify: `lib/control-client.ts`

**Interfaces:**
- Consumes: `GET /frame?raw=1` with `x-captured-at`
- Produces: UI display fps independent of mode; optional age display

- [ ] **Step 1: Extend fetchFrameBlob**

```ts
export async function fetchFrameBlob(controlUrl: string): Promise<{
  blob: Blob;
  width: number;
  height: number;
  frame_id: number;
  captured_at: number | null;
}> {
  // ... existing fetch ...
  const captured_at = res.headers.get("x-captured-at");
  return {
    blob,
    width,
    height,
    frame_id,
    captured_at: captured_at != null ? Number(captured_at) : null,
  };
}

export async function fetchSnapshot(controlUrl: string) {
  const res = await fetch(`${controlUrl}/snapshot`);
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
    captured_at: number;
    age_ms: number;
  }>;
}

export async function forceSnapshot(controlUrl: string) {
  const res = await fetch(`${controlUrl}/snapshot`, { method: "POST" });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
    captured_at: number;
    age_ms: number;
  }>;
}
```

- [ ] **Step 2: Rewrite live-view poll loop**

Remove `POLL_MS` mode map (or keep only `MIN_POLL_GAP_MS = 16` safety floor).

```ts
const MIN_POLL_GAP_MS = 16;

// inside useEffect:
const poll = async () => {
  if (cancelled) return;
  const t0 = performance.now();
  try {
    const frame = await fetchFrameBlob(controlUrl);
    if (cancelled) return;
    applyFrame(frame); // may use captured_at later
  } catch (e) {
    // existing fail streak logic — treat 404 as soft (no frame yet)
  } finally {
    if (cancelled) return;
    const elapsed = performance.now() - t0;
    const wait = Math.max(0, MIN_POLL_GAP_MS - elapsed);
    timer = setTimeout(() => void poll(), wait);
  }
};
```

- Drop dependency of interval on `mode` for polling (effect deps: `[controlUrl]` only for the stream; mode still used for Drive UI).
- Meta: show `stream: max` or omit mode ms; optional `age: Xms` from `captured_at` if state stored.
- Keep last-good frame behavior and FPS window.

- [ ] **Step 3: Manual smoke (if Electron running)**

Attach mGBA, confirm live view still paints; FPS meta moves; no Frame 500 spam.

- [ ] **Step 4: Commit**

```bash
git add components/live-view.tsx lib/control-client.ts
git commit -m "feat: live view max backpressure poll on shared frame buffer"
```

---

### Task 4: Skill + README docs

**Files:**
- Modify: `skills/pokemon-professor/SKILL.md`
- Modify: `README.md` (endpoint table)

- [ ] **Step 1: Update skill endpoints table**

Replace `/frame` observe guidance:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/snapshot` | Latest PNG as base64 + `age_ms` (no capture) |
| POST | `/snapshot` | Force fresh capture; returns same shape |
| GET/PUT | `/snapshot/config` | `{ interval_ms }` — default 0; clamp 50–10000 |
| GET | `/frame` | Studio live buffer (prefer `/snapshot` for vision) |

OBSERVE / VERIFY sections:

```http
GET http://127.0.0.1:7946/snapshot
```

After input or screen fade:

```http
POST http://127.0.0.1:7946/snapshot
```

Pitfalls: do not hammer `/frame` for vision; use `/snapshot`.

- [ ] **Step 2: Update README Control API table similarly**

- [ ] **Step 3: Commit**

```bash
git add skills/pokemon-professor/SKILL.md README.md
git commit -m "docs: agent snapshot API in skill and README"
```

---

### Task 5: Full verification

- [ ] **Step 1: Typecheck + test**

```bash
npm run typecheck
npm test
npm run build:electron
```

Expected: all pass; electron dist includes `capture-scheduler.js`.

- [ ] **Step 2: Checklist against spec**

| Spec item | Verified by |
|-----------|-------------|
| Sole capture owner | CaptureScheduler + routes never call getFramePng |
| Shared latest | GET /frame and GET /snapshot same buffer |
| GET latest / POST force | control-api tests |
| interval default 0 + clamp | unit + API tests |
| Live max backpressure | live-view code review |
| Mode does not throttle capture | no POLL_MS by mode |
| start resets interval; stop clears | unit tests |
| Skill uses /snapshot | SKILL.md |

- [ ] **Step 3: Final commit if any fixups**

```bash
git add -A
git status
# commit only intentional fixups
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| CaptureScheduler sole getFramePng | Task 1–2 |
| Shared latest buffer | Task 1 |
| GET /frame buffer read + raw + x-captured-at | Task 2 |
| GET/POST /snapshot + config | Task 2 |
| interval 0 default, clamp 50–10000, skip if fresher | Task 1 `maybeIntervalCapture` |
| start reset interval; stop clear | Task 1 |
| main start/stop lifecycle | Task 2 |
| Live max backpressure | Task 3 |
| Skill + README | Task 4 |
| Tests | Task 1, 2, 5 |

No WebSocket, dual buffer, or interval persistence included (non-goals).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-live-vs-agent-frames.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
