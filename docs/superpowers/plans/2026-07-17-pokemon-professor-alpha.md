# Pokemon Professor Alpha A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Alpha A — a Windows-first Electron studio where a Professor loads FireRed, watches live mGBA frames, coaches Hermes via chat, and rescues the agent with Nudge/Drive, with savestate resume.

**Architecture:** Studio owns an HTTP Control API and mGBA sidecar supervisor. Hermes never talks to mGBA directly; a Professor skill calls localhost routes. An `EmulatorBackend` interface allows a Mock backend for tests and an mGBA Lua-TCP backend for real play. Vertical-slice order: mode machine → Control API → mock backend → UI shell → real mGBA → Hermes chat → Run/mission/save.

**Tech Stack:** Electron, Next.js (App Router), TypeScript, Node `http` Control API in main process, Vitest, mGBA 0.10+ with Lua scripting (TCP bridge), local JSON run store under Electron userData.

**Spec:** `docs/superpowers/specs/2026-07-17-pokemon-professor-design.md`

## Global Constraints

- FireRed only; user-supplied ROM; never download or ship ROMs.
- Control API binds **localhost only**.
- Local Hermes required for chat/agent; emulator + Drive work if Hermes is down.
- Mode machine: `agent` | `nudge` | `drive`; non-agent `POST /input` → HTTP 409.
- Short input batches only (max 5 actions per request in Alpha).
- mGBA: first-run download into user-data with consent + checksum; manual binary fallback.
- Alpha platform focus: **Windows**.
- Do not implement Beta features (template pack, autosave policy, FireRedState B-lite, usage panel polish) until Alpha checklist in Task 12 passes.
- No accounts, credits, tournaments, or blockchain.

---

## File map (Alpha)

```
pokemon-professor/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── next.config.ts
├── electron/
│   ├── main.ts                 # Electron main: window, paths, wire API + supervisor
│   ├── preload.ts              # contextBridge for renderer
│   ├── control-api/
│   │   ├── server.ts           # HTTP server
│   │   ├── routes.ts           # route handlers
│   │   ├── types.ts            # shared API types
│   │   └── mode-machine.ts     # agent|nudge|drive
│   ├── emulator/
│   │   ├── backend.ts          # EmulatorBackend interface
│   │   ├── mock-backend.ts     # deterministic mock for tests + dev without ROM
│   │   ├── mgba-backend.ts     # real sidecar client
│   │   ├── mgba-supervisor.ts  # download, spawn, lifecycle
│   │   └── mgba-bridge.lua     # runs inside mGBA; TCP protocol
│   ├── runs/
│   │   ├── store.ts            # JSON file Run store
│   │   └── types.ts
│   └── paths.ts                # userData layout
├── app/                        # Next.js renderer
│   ├── layout.tsx
│   ├── page.tsx                # studio shell
│   ├── globals.css
│   └── api/hermes/chat/route.ts
├── components/
│   ├── live-view.tsx
│   ├── chat-bar.tsx
│   ├── run-rail.tsx
│   └── override-controls.tsx
├── lib/
│   ├── control-client.ts       # renderer fetch helpers to Control API
│   └── hermes.ts
├── skills/pokemon-professor/
│   └── SKILL.md
├── tests/
│   ├── mode-machine.test.ts
│   ├── control-api.test.ts
│   ├── mock-backend.test.ts
│   ├── run-store.test.ts
│   └── skill-protocol.test.ts
└── docs/superpowers/specs/2026-07-17-pokemon-professor-design.md
```

---

## Shared types (canonical — implement in Task 1)

These names and shapes are **law** for later tasks.

```typescript
// electron/control-api/types.ts

export const API_VERSION = "0.1.0";

export type ControlMode = "agent" | "nudge" | "drive";

export type Button =
  | "A"
  | "B"
  | "START"
  | "SELECT"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "L"
  | "R";

export interface FireRedState {
  map_id?: number;
  map_name?: string;
  x?: number;
  y?: number;
  party?: Array<{
    species?: string;
    level?: number;
    hp?: number;
    max_hp?: number;
    status?: string;
  }>;
  in_battle?: boolean;
  badges?: number;
  money?: number;
}

export interface HealthResponse {
  ok: true;
  api_version: string;
  mode: ControlMode;
  emulator: "mock" | "mgba" | "none";
  rom_loaded: boolean;
  run_id: string | null;
}

export interface FrameResponse {
  mime: "image/png";
  /** base64-encoded PNG */
  data: string;
  width: number;
  height: number;
  frame_id: number;
}

export interface StateResponse {
  state: FireRedState | null;
}

export interface InputRequest {
  buttons: Button[];
}

export interface InputResponse {
  ok: true;
  executed: Button[];
  mode: ControlMode;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  mode?: ControlMode;
}

export interface ModeRequest {
  mode: ControlMode;
}

export interface ModeResponse {
  ok: true;
  mode: ControlMode;
}

export interface SaveRequest {
  name: string;
}

export interface SaveResponse {
  ok: true;
  name: string;
  path: string;
}

export interface LoadRequest {
  name: string;
}

export interface LoadResponse {
  ok: true;
  name: string;
}

export interface SavesResponse {
  saves: string[];
}

export type MissionSource = "template" | "freeform";
export type MissionStatus = "active" | "paused" | "done" | "aborted";
export type RunStatus = "active" | "paused" | "ended";

export interface Mission {
  id: string;
  prompt: string;
  source: MissionSource;
  status: MissionStatus;
  started_at: string;
  ended_at?: string;
}

export interface RunEvent {
  at: string;
  type: string;
  detail?: Record<string, unknown>;
}

export interface Run {
  id: string;
  rom_path: string;
  created_at: string;
  status: RunStatus;
  missions: Mission[];
  events: RunEvent[];
  savestates: string[];
}

export interface EmulatorBackend {
  readonly kind: "mock" | "mgba";
  start(romPath: string): Promise<void>;
  stop(): Promise<void>;
  isRomLoaded(): boolean;
  getFramePng(): Promise<{ data: Buffer; width: number; height: number; frame_id: number }>;
  getState(): Promise<FireRedState | null>;
  press(buttons: Button[]): Promise<void>;
  saveState(name: string, dir: string): Promise<string>;
  loadState(name: string, dir: string): Promise<void>;
  listSaves(dir: string): Promise<string[]>;
}
```

**mGBA bridge protocol (line-delimited JSON over TCP, localhost):**

```text
Client → mGBA: {"cmd":"ping"}
mGBA → Client: {"ok":true,"pong":true}

Client → mGBA: {"cmd":"frame"}
mGBA → Client: {"ok":true,"width":240,"height":160,"png_base64":"..."}

Client → mGBA: {"cmd":"input","buttons":["A","RIGHT"]}
mGBA → Client: {"ok":true,"executed":["A","RIGHT"]}

Client → mGBA: {"cmd":"save","path":"C:/.../name.ss0"}
mGBA → Client: {"ok":true}

Client → mGBA: {"cmd":"load","path":"C:/.../name.ss0"}
mGBA → Client: {"ok":true}
```

Default bridge port: `7947` (Control API on `7946`).

---

### Task 1: Scaffold package + shared types + mode machine

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `electron/control-api/types.ts`
- Create: `electron/control-api/mode-machine.ts`
- Create: `tests/mode-machine.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `API_VERSION`, all types above; `ModeMachine` with `get()`, `set(mode)`, `assertAgent()` 

- [ ] **Step 1: Write the failing test**

Create `tests/mode-machine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ModeMachine } from "../electron/control-api/mode-machine";

describe("ModeMachine", () => {
  it("starts in agent mode", () => {
    const m = new ModeMachine();
    expect(m.get()).toBe("agent");
  });

  it("transitions to nudge and drive", () => {
    const m = new ModeMachine();
    m.set("nudge");
    expect(m.get()).toBe("nudge");
    m.set("drive");
    expect(m.get()).toBe("drive");
    m.set("agent");
    expect(m.get()).toBe("agent");
  });

  it("assertAgent throws when not agent", () => {
    const m = new ModeMachine();
    m.set("nudge");
    expect(() => m.assertAgent()).toThrow(/nudge/);
  });

  it("assertAgent succeeds in agent mode", () => {
    const m = new ModeMachine();
    expect(() => m.assertAgent()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mode-machine.test.ts`  
Expected: FAIL (module not found / cannot resolve)

- [ ] **Step 3: Create package scaffold and implementation**

`package.json`:

```json
{
  "name": "pokemon-professor",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build:electron": "tsc -p tsconfig.electron.json",
    "dev:web": "next dev -p 3848",
    "dev:electron": "npm run build:electron && electron .",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/uuid": "^10.0.0",
    "electron": "^33.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "paths": { "@/*": ["./*"] },
    "types": ["node"]
  },
  "include": ["electron/**/*", "app/**/*", "components/**/*", "lib/**/*", "tests/**/*"]
}
```

`tsconfig.electron.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist-electron",
    "rootDir": "electron",
    "jsx": "react-jsx",
    "noEmit": false
  },
  "include": ["electron/**/*"]
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`.gitignore`:

```
node_modules
.next
dist-desktop
dist-electron
*.log
.env
.env.local
user-data
```

`electron/control-api/types.ts`: paste the full shared types block from **Shared types** above.

`electron/control-api/mode-machine.ts`:

```typescript
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
```

- [ ] **Step 4: Install and run tests**

Run:

```powershell
npm install
npx vitest run tests/mode-machine.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.electron.json vitest.config.ts .gitignore electron/control-api/types.ts electron/control-api/mode-machine.ts tests/mode-machine.test.ts
git commit -m "feat: scaffold package and mode machine"
```

---

### Task 2: Mock EmulatorBackend

**Files:**
- Create: `electron/emulator/backend.ts`
- Create: `electron/emulator/mock-backend.ts`
- Create: `tests/mock-backend.test.ts`

**Interfaces:**
- Consumes: `Button`, `FireRedState`, `EmulatorBackend` from types
- Produces: `MockBackend` implementing `EmulatorBackend`

- [ ] **Step 1: Write the failing test**

```typescript
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
    const savePath = await backend.saveState("before_brock", tmp);
    expect(fs.existsSync(savePath)).toBe(true);
    await backend.press(["DOWN", "DOWN"]);
    await backend.loadState("before_brock", tmp);
    const saves = await backend.listSaves(tmp);
    expect(saves).toContain("before_brock");
  });

  it("getState returns stub null party shape for alpha", async () => {
    await backend.start("x.gba");
    const state = await backend.getState();
    expect(state).toEqual(null);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/mock-backend.test.ts`

- [ ] **Step 3: Implement mock backend**

`electron/emulator/backend.ts`:

```typescript
export type { EmulatorBackend } from "../control-api/types";
```

`electron/emulator/mock-backend.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { Button, EmulatorBackend, FireRedState } from "../control-api/types";

/** Minimal valid 240x160 solid-color PNG (precomputed). */
function solidPng(): Buffer {
  // 1x1 PNG is fine for tests if we report width/height as 240x160 metadata,
  // but prefer a real tiny PNG buffer:
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  return png1x1;
}

export class MockBackend implements EmulatorBackend {
  readonly kind = "mock" as const;
  private loaded = false;
  private frameId = 0;
  private pressCount = 0;

  async start(_romPath: string): Promise<void> {
    this.loaded = true;
    this.frameId = 0;
    this.pressCount = 0;
  }

  async stop(): Promise<void> {
    this.loaded = false;
  }

  isRomLoaded(): boolean {
    return this.loaded;
  }

  async getFramePng() {
    if (!this.loaded) throw new Error("rom not loaded");
    return {
      data: solidPng(),
      width: 240,
      height: 160,
      frame_id: this.frameId,
    };
  }

  async getState(): Promise<FireRedState | null> {
    return null;
  }

  async press(buttons: Button[]): Promise<void> {
    if (!this.loaded) throw new Error("rom not loaded");
    this.pressCount += buttons.length;
    this.frameId += 1;
  }

  async saveState(name: string, dir: string): Promise<string> {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.mockstate`);
    fs.writeFileSync(
      file,
      JSON.stringify({ frameId: this.frameId, pressCount: this.pressCount }),
      "utf8"
    );
    return file;
  }

  async loadState(name: string, dir: string): Promise<void> {
    const file = path.join(dir, `${name}.mockstate`);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      frameId: number;
      pressCount: number;
    };
    this.frameId = raw.frameId;
    this.pressCount = raw.pressCount;
  }

  async listSaves(dir: string): Promise<string[]> {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".mockstate"))
      .map((f) => f.replace(/\.mockstate$/, ""));
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/mock-backend.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add electron/emulator tests/mock-backend.test.ts
git commit -m "feat: add Mock EmulatorBackend"
```

---

### Task 3: Control API server (mock backend)

**Files:**
- Create: `electron/control-api/server.ts`
- Create: `electron/control-api/routes.ts`
- Create: `electron/control-api/context.ts`
- Create: `tests/control-api.test.ts`

**Interfaces:**
- Consumes: `ModeMachine`, `EmulatorBackend`, types
- Produces: `createControlServer(ctx) → { url, close }`; routes on port **7946**

- [ ] **Step 1: Write the failing integration test**

```typescript
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement server**

`electron/control-api/context.ts`:

```typescript
import type { ModeMachine } from "./mode-machine";
import type { EmulatorBackend } from "../emulator/backend";

export interface ControlContext {
  mode: ModeMachine;
  backend: EmulatorBackend;
  getRunId: () => string | null;
  getSaveDir: () => string;
}
```

`electron/control-api/routes.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "http";
import type { ControlContext } from "./context";
import {
  API_VERSION,
  type Button,
  type ControlMode,
} from "./types";

const VALID_BUTTONS = new Set<Button>([
  "A",
  "B",
  "START",
  "SELECT",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "L",
  "R",
]);

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function handleRequest(
  ctx: ControlContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = req.method || "GET";
  const p = url.pathname;

  try {
    if (method === "GET" && p === "/health") {
      return send(res, 200, {
        ok: true,
        api_version: API_VERSION,
        mode: ctx.mode.get(),
        emulator: ctx.backend.isRomLoaded() ? ctx.backend.kind : "none",
        rom_loaded: ctx.backend.isRomLoaded(),
        run_id: ctx.getRunId(),
      });
    }

    if (method === "GET" && p === "/frame") {
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const frame = await ctx.backend.getFramePng();
      return send(res, 200, {
        mime: "image/png",
        data: frame.data.toString("base64"),
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
      });
    }

    if (method === "GET" && p === "/state") {
      const state = ctx.backend.isRomLoaded()
        ? await ctx.backend.getState()
        : null;
      return send(res, 200, { state });
    }

    if (method === "GET" && p === "/mode") {
      return send(res, 200, { ok: true, mode: ctx.mode.get() });
    }

    if (method === "POST" && p === "/mode") {
      const body = (await readJson(req)) as { mode?: ControlMode };
      if (!body.mode || !["agent", "nudge", "drive"].includes(body.mode)) {
        return send(res, 400, { ok: false, error: "invalid mode" });
      }
      ctx.mode.set(body.mode);
      return send(res, 200, { ok: true, mode: ctx.mode.get() });
    }

    if (method === "POST" && p === "/input") {
      if (ctx.mode.get() !== "agent") {
        return send(res, 409, {
          ok: false,
          error: `input blocked: mode is ${ctx.mode.get()}`,
          mode: ctx.mode.get(),
        });
      }
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const body = (await readJson(req)) as { buttons?: Button[] };
      const buttons = body.buttons || [];
      if (!Array.isArray(buttons) || buttons.length === 0) {
        return send(res, 400, { ok: false, error: "buttons required" });
      }
      if (buttons.length > 5) {
        return send(res, 400, {
          ok: false,
          error: "max 5 buttons per request",
        });
      }
      for (const b of buttons) {
        if (!VALID_BUTTONS.has(b)) {
          return send(res, 400, { ok: false, error: `invalid button: ${b}` });
        }
      }
      await ctx.backend.press(buttons);
      return send(res, 200, {
        ok: true,
        executed: buttons,
        mode: ctx.mode.get(),
      });
    }

    if (method === "POST" && p === "/save") {
      const body = (await readJson(req)) as { name?: string };
      if (!body.name || !/^[\w.-]+$/.test(body.name)) {
        return send(res, 400, { ok: false, error: "invalid name" });
      }
      const file = await ctx.backend.saveState(body.name, ctx.getSaveDir());
      return send(res, 200, { ok: true, name: body.name, path: file });
    }

    if (method === "POST" && p === "/load") {
      const body = (await readJson(req)) as { name?: string };
      if (!body.name) {
        return send(res, 400, { ok: false, error: "name required" });
      }
      await ctx.backend.loadState(body.name, ctx.getSaveDir());
      return send(res, 200, { ok: true, name: body.name });
    }

    if (method === "GET" && p === "/saves") {
      const saves = await ctx.backend.listSaves(ctx.getSaveDir());
      return send(res, 200, { saves });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return send(res, 500, { ok: false, error: msg });
  }
}
```

`electron/control-api/server.ts`:

```typescript
import http from "http";
import type { ControlContext } from "./context";
import { handleRequest } from "./routes";

export interface ServerOptions {
  host?: string;
  port?: number;
}

export async function createControlServer(
  ctx: ControlContext,
  opts: ServerOptions = {}
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 7946;

  const server = http.createServer((req, res) => {
    void handleRequest(ctx, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind control server");
  }

  return {
    url: `http://${host}:${addr.port}`,
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/control-api.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add electron/control-api tests/control-api.test.ts
git commit -m "feat: Control API with mode-gated input"
```

---

### Task 4: Run store (JSON)

**Files:**
- Create: `electron/runs/types.ts`
- Create: `electron/runs/store.ts`
- Create: `electron/paths.ts`
- Create: `tests/run-store.test.ts`

**Interfaces:**
- Consumes: `Run`, `Mission` types
- Produces: `RunStore.create`, `get`, `list`, `addMission`, `appendEvent`, `updateMissionStatus`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RunStore } from "../electron/runs/store";

describe("RunStore", () => {
  let root: string;
  let store: RunStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-runs-"));
    store = new RunStore(root);
  });

  it("creates and loads a run", () => {
    const run = store.create({ rom_path: "C:\\\\roms\\\\firered.gba" });
    expect(run.id).toBeTruthy();
    expect(run.status).toBe("active");
    expect(run.missions).toEqual([]);
    const loaded = store.get(run.id);
    expect(loaded?.rom_path).toContain("firered.gba");
  });

  it("adds freeform mission and events", () => {
    const run = store.create({ rom_path: "r.gba" });
    const mission = store.addMission(run.id, {
      prompt: "Leave Pallet Town and head north",
      source: "freeform",
    });
    expect(mission.status).toBe("active");
    store.appendEvent(run.id, {
      type: "mission_started",
      detail: { mission_id: mission.id },
    });
    store.updateMissionStatus(run.id, mission.id, "done");
    const final = store.get(run.id)!;
    expect(final.missions[0].status).toBe("done");
    expect(final.events.some((e) => e.type === "mission_started")).toBe(true);
  });

  it("lists runs newest first", () => {
    const a = store.create({ rom_path: "a.gba" });
    const b = store.create({ rom_path: "b.gba" });
    const list = store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`electron/paths.ts`:

```typescript
import * as path from "path";

export function appLayout(userData: string) {
  return {
    root: userData,
    runs: path.join(userData, "runs"),
    mgba: path.join(userData, "mgba"),
    saves: (runId: string) => path.join(userData, "runs", runId, "saves"),
    runFile: (runId: string) => path.join(userData, "runs", runId, "run.json"),
  };
}
```

`electron/runs/types.ts` — re-export Run/Mission/RunEvent from control-api types or duplicate import:

```typescript
export type {
  Run,
  Mission,
  RunEvent,
  MissionSource,
  MissionStatus,
  RunStatus,
} from "../control-api/types";
```

`electron/runs/store.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { Mission, MissionSource, MissionStatus, Run, RunEvent } from "./types";

export class RunStore {
  constructor(private rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private runDir(id: string) {
    return path.join(this.rootDir, id);
  }

  private runPath(id: string) {
    return path.join(this.runDir(id), "run.json");
  }

  create(opts: { rom_path: string }): Run {
    const id = randomUUID();
    const run: Run = {
      id,
      rom_path: opts.rom_path,
      created_at: new Date().toISOString(),
      status: "active",
      missions: [],
      events: [],
      savestates: [],
    };
    fs.mkdirSync(path.join(this.runDir(id), "saves"), { recursive: true });
    this.write(run);
    return run;
  }

  get(id: string): Run | null {
    const p = this.runPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as Run;
  }

  list(): Run[] {
    if (!fs.existsSync(this.rootDir)) return [];
    const ids = fs.readdirSync(this.rootDir);
    const runs = ids
      .map((id) => this.get(id))
      .filter((r): r is Run => r !== null);
    runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return runs;
  }

  addMission(
    runId: string,
    opts: { prompt: string; source: MissionSource }
  ): Mission {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    const mission: Mission = {
      id: randomUUID(),
      prompt: opts.prompt,
      source: opts.source,
      status: "active",
      started_at: new Date().toISOString(),
    };
    run.missions.push(mission);
    this.write(run);
    return mission;
  }

  updateMissionStatus(
    runId: string,
    missionId: string,
    status: MissionStatus
  ): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    const m = run.missions.find((x) => x.id === missionId);
    if (!m) throw new Error("mission not found");
    m.status = status;
    if (status === "done" || status === "aborted") {
      m.ended_at = new Date().toISOString();
    }
    this.write(run);
  }

  appendEvent(
    runId: string,
    event: { type: string; detail?: Record<string, unknown> }
  ): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    const row: RunEvent = {
      at: new Date().toISOString(),
      type: event.type,
      detail: event.detail,
    };
    run.events.push(row);
    this.write(run);
  }

  registerSavestate(runId: string, name: string): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    if (!run.savestates.includes(name)) run.savestates.push(name);
    this.write(run);
  }

  private write(run: Run): void {
    fs.mkdirSync(this.runDir(run.id), { recursive: true });
    fs.writeFileSync(this.runPath(run.id), JSON.stringify(run, null, 2), "utf8");
  }
}
```

- [ ] **Step 4: PASS tests + commit**

```powershell
npx vitest run tests/run-store.test.ts
git add electron/runs electron/paths.ts tests/run-store.test.ts
git commit -m "feat: JSON RunStore for missions and events"
```

---

### Task 5: Electron main + preload + wire Control API

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Modify: `package.json` scripts if needed

**Interfaces:**
- Consumes: `createControlServer`, `RunStore`, `MockBackend` (default until Task 7)
- Produces: IPC `studio:getPaths`, `studio:getControlUrl`, `studio:createRun`, `studio:listRuns`, `studio:addMission`, `studio:setMode`, `studio:save`, `studio:load`

- [ ] **Step 1: Implement main process**

`electron/preload.ts`:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("studio", {
  getControlUrl: () => ipcRenderer.invoke("studio:getControlUrl") as Promise<string>,
  getPaths: () => ipcRenderer.invoke("studio:getPaths"),
  createRun: (romPath: string) =>
    ipcRenderer.invoke("studio:createRun", romPath),
  listRuns: () => ipcRenderer.invoke("studio:listRuns"),
  addMission: (runId: string, prompt: string) =>
    ipcRenderer.invoke("studio:addMission", runId, prompt),
  setMode: (mode: "agent" | "nudge" | "drive") =>
    ipcRenderer.invoke("studio:setMode", mode),
  save: (name: string) => ipcRenderer.invoke("studio:save", name),
  load: (name: string) => ipcRenderer.invoke("studio:load", name),
  pickRom: () => ipcRenderer.invoke("studio:pickRom") as Promise<string | null>,
});
```

`electron/main.ts` (core structure):

```typescript
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import { createControlServer } from "./control-api/server";
import { ModeMachine } from "./control-api/mode-machine";
import { MockBackend } from "./emulator/mock-backend";
import type { EmulatorBackend } from "./emulator/backend";
import { RunStore } from "./runs/store";
import { appLayout } from "./paths";
import type { ControlMode } from "./control-api/types";

let mainWindow: BrowserWindow | null = null;
let controlUrl = "";
let backend: EmulatorBackend;
let mode: ModeMachine;
let store: RunStore;
let currentRunId: string | null = null;
let layout: ReturnType<typeof appLayout>;

async function bootstrap() {
  layout = appLayout(app.getPath("userData"));
  store = new RunStore(layout.runs);
  mode = new ModeMachine();
  backend = new MockBackend();

  const server = await createControlServer(
    {
      mode,
      backend,
      getRunId: () => currentRunId,
      getSaveDir: () =>
        currentRunId ? layout.saves(currentRunId) : path.join(layout.root, "orphan-saves"),
    },
    { host: "127.0.0.1", port: 7946 }
  );
  controlUrl = server.url;

  ipcMain.handle("studio:getControlUrl", () => controlUrl);
  ipcMain.handle("studio:getPaths", () => layout);
  ipcMain.handle("studio:listRuns", () => store.list());
  ipcMain.handle("studio:pickRom", async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "GBA ROM", extensions: ["gba"] }],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle("studio:createRun", async (_e, romPath: string) => {
    const run = store.create({ rom_path: romPath });
    currentRunId = run.id;
    await backend.stop().catch(() => undefined);
    await backend.start(romPath);
    store.appendEvent(run.id, { type: "run_started" });
    return run;
  });
  ipcMain.handle(
    "studio:addMission",
    (_e, runId: string, prompt: string) => {
      const mission = store.addMission(runId, {
        prompt,
        source: "freeform",
      });
      store.appendEvent(runId, {
        type: "mission_started",
        detail: { mission_id: mission.id, prompt },
      });
      return mission;
    }
  );
  ipcMain.handle("studio:setMode", async (_e, next: ControlMode) => {
    mode.set(next);
    if (currentRunId) {
      store.appendEvent(currentRunId, {
        type: `mode_${next}`,
      });
    }
    return mode.get();
  });
  ipcMain.handle("studio:save", async (_e, name: string) => {
    if (!currentRunId) throw new Error("no active run");
    const file = await backend.saveState(name, layout.saves(currentRunId));
    store.registerSavestate(currentRunId, name);
    store.appendEvent(currentRunId, { type: "savestate", detail: { name } });
    return { name, path: file };
  });
  ipcMain.handle("studio:load", async (_e, name: string) => {
    if (!currentRunId) throw new Error("no active run");
    await backend.loadState(name, layout.saves(currentRunId));
    store.appendEvent(currentRunId, { type: "loadstate", detail: { name } });
    return { name };
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.PP_DEV_URL || "http://127.0.0.1:3848";
  if (process.env.PP_DEV_URL || !app.isPackaged) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
  }
}

app.whenReady().then(bootstrap);
```

- [ ] **Step 2: Manual smoke**

```powershell
npm run build:electron
# optional: start next later; for now verify process boots
$env:PP_DEV_URL="about:blank"; npx electron .
```

Expected: window opens; `curl http://127.0.0.1:7946/health` returns ok.

- [ ] **Step 3: Commit**

```powershell
git add electron/main.ts electron/preload.ts package.json
git commit -m "feat: Electron main wires Control API and Run IPC"
```

---

### Task 6: Next.js studio UI (live view mock + override + run rail)

**Files:**
- Create: `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `components/live-view.tsx`, `override-controls.tsx`, `run-rail.tsx`, `chat-bar.tsx` (chat stub)
- Create: `lib/control-client.ts`
- Create: `types/studio.d.ts`

**Interfaces:**
- Consumes: `window.studio` IPC + `fetch(controlUrl + '/frame')`
- Produces: usable Alpha shell without Hermes

- [ ] **Step 1: control client**

`lib/control-client.ts`:

```typescript
export async function fetchFrame(controlUrl: string) {
  const res = await fetch(`${controlUrl}/frame`);
  if (!res.ok) throw new Error(`frame ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
  }>;
}

export async function fetchHealth(controlUrl: string) {
  const res = await fetch(`${controlUrl}/health`);
  return res.json();
}
```

`types/studio.d.ts`:

```typescript
export {};

declare global {
  interface Window {
    studio?: {
      getControlUrl: () => Promise<string>;
      createRun: (romPath: string) => Promise<{ id: string }>;
      listRuns: () => Promise<unknown[]>;
      addMission: (runId: string, prompt: string) => Promise<unknown>;
      setMode: (mode: "agent" | "nudge" | "drive") => Promise<string>;
      save: (name: string) => Promise<unknown>;
      load: (name: string) => Promise<unknown>;
      pickRom: () => Promise<string | null>;
    };
  }
}
```

- [ ] **Step 2: Components**

`components/live-view.tsx` — poll `/frame` every 250ms when controlUrl set; render `<img src={`data:image/png;base64,${data}`} />`.

`components/override-controls.tsx` — buttons Nudge / Drive / Resume Agent calling `window.studio.setMode`. In Drive mode, attach `window` keydown for arrow keys + Z/X as A/B and `POST /input` **only if** you temporarily set mode to allow human input — **important:** Drive must inject via a dedicated IPC `studio:driveInput` that bypasses agent gate.

**Add in this task** to main/preload:

```typescript
// main
ipcMain.handle("studio:driveInput", async (_e, buttons: Button[]) => {
  if (mode.get() !== "drive") throw new Error("not in drive mode");
  await backend.press(buttons);
  return { ok: true };
});
```

Human Drive must **not** use agent `POST /input` (that is 409). Use IPC `driveInput` instead.

`components/run-rail.tsx` — Pick ROM, Start Run, mission text field + Start Mission, Save name + Save/Load.

`components/chat-bar.tsx` — placeholder textarea "Hermes chat connects in Task 8".

`app/page.tsx` — compose layout: run-rail | live-view | override; bottom chat-bar.

- [ ] **Step 3: Manual test**

```powershell
npm run dev:web
# other terminal
npm run build:electron
$env:PP_DEV_URL="http://127.0.0.1:3848"; npx electron .
```

Checklist: pick ROM (any path — mock ignores content) → Start Run → frame appears → Nudge freezes agent path → Drive moves mock frame_id via keys → Save/Load.

- [ ] **Step 4: Commit**

```powershell
git add app components lib types electron/main.ts electron/preload.ts next.config.ts
git commit -m "feat: studio UI live view, override, run rail"
```

---

### Task 7: mGBA supervisor + Lua bridge + MgbaBackend

**Files:**
- Create: `electron/emulator/mgba-bridge.lua`
- Create: `electron/emulator/mgba-backend.ts`
- Create: `electron/emulator/mgba-supervisor.ts`
- Create: `electron/emulator/mgba-download.ts`
- Modify: `electron/main.ts` to prefer mGBA when binary present
- Create: `tests/mgba-backend.manual.md` (manual checklist — automated only if CI has mGBA)

**Interfaces:**
- Consumes: bridge protocol defined in Shared types
- Produces: `MgbaBackend`, `ensureMgbaBinary(userData)`, `spawnMgba({ bin, rom, script, port })`

- [ ] **Step 1: Implement Lua bridge**

`electron/emulator/mgba-bridge.lua` — load on mGBA start (via CLI script flag if available, or document Tools→Scripting for alpha fallback). Protocol: TCP listen `127.0.0.1:7947`, parse one JSON object per line, respond one JSON line.

Minimum commands: `ping`, `frame` (capture callbacks / screenshot API per mGBA scripting docs), `input` (key events), `save`, `load`.

If a scripting API method name differs by mGBA version, isolate lookups in one Lua table and fail with clear `{"ok":false,"error":"..."}`.

- [ ] **Step 2: MgbaBackend TCP client**

`electron/emulator/mgba-backend.ts` — connect to bridge, implement `EmulatorBackend`. Timeouts: 5s. `start` assumes supervisor already spawned process.

- [ ] **Step 3: Supervisor + download**

`mgba-download.ts`:

- Config constant: official Windows download URL + expected sha256 (pin a specific mGBA release, e.g. 0.10.x, in code comments).
- Flow: if `userData/mgba/mgba.exe` missing → throw `MgbaMissingError` with code `NEEDS_DOWNLOAD`.
- `downloadMgba(userData, onProgress)`: fetch zip, verify sha256, extract to `userData/mgba/`.

`mgba-supervisor.ts`:

```typescript
export async function spawnMgba(opts: {
  exePath: string;
  romPath: string;
  scriptPath: string;
  bridgePort: number;
}): Promise<{ stop: () => void; pid: number }>
```

Spawn detached child with args needed for ROM + script. On Windows use `spawn` with `windowsHide: true` optional.

- [ ] **Step 4: Wire first-run UX**

In renderer onboarding modal: "Download mGBA into app data" → IPC `studio:ensureMgba` → download → spawn on createRun when `USE_MOCK_EMULATOR` is not set.

Env override for dev: `PP_EMULATOR=mock|mgba`.

- [ ] **Step 5: Manual verification with real FireRed ROM**

Do **not** commit ROMs. Engineer uses own dump.

Checklist in `tests/mgba-backend.manual.md`:

1. Download mGBA via app  
2. Load FireRed  
3. Frame shows game screen  
4. Drive: move character  
5. Save/load savestate  
6. `curl /health` shows `emulator: mgba`

- [ ] **Step 6: Commit**

```powershell
git add electron/emulator tests/mgba-backend.manual.md electron/main.ts
git commit -m "feat: mGBA sidecar backend and first-run download"
```

---

### Task 8: Hermes chat proxy + chat bar (forge-style)

**Files:**
- Create: `app/api/hermes/chat/route.ts`
- Create: `lib/hermes.ts`
- Modify: `components/chat-bar.tsx`
- Create: `.env.example`

**Interfaces:**
- Consumes: Hermes OpenAI-compatible API at `HERMES_BASE_URL` default `http://127.0.0.1:8642`
- Produces: `POST /api/hermes/chat` streaming or JSON relay

- [ ] **Step 1: Implement proxy**

`lib/hermes.ts`:

```typescript
export function hermesConfig() {
  return {
    baseUrl: process.env.HERMES_BASE_URL || "http://127.0.0.1:8642",
    apiKey: process.env.HERMES_API_KEY || "",
  };
}
```

`app/api/hermes/chat/route.ts` — POST body `{ messages: [...] }`, forward to `${baseUrl}/v1/chat/completions` (adjust path to match Hermes gateway docs). On ECONNREFUSED return 503 JSON `{ error: "hermes_unavailable", hint: "Run hermes gateway" }`.

- [ ] **Step 2: Chat bar UI**

- Message list + input  
- On send → `/api/hermes/chat`  
- Show connection badge: green if health check to Hermes works, gray if not  
- Do not block emulator UI when Hermes down  

- [ ] **Step 3: Manual test**

With `hermes gateway` running: send "hello". Without: clear unavailable message.

- [ ] **Step 4: Commit**

```powershell
git add app/api/hermes lib/hermes.ts components/chat-bar.tsx .env.example
git commit -m "feat: Hermes chat proxy and global chat bar"
```

---

### Task 9: Pokemon Professor Hermes skill

**Files:**
- Create: `skills/pokemon-professor/SKILL.md`
- Create: `tests/skill-protocol.test.ts` (documents expected tool HTTP calls; pure contract test)

**Interfaces:**
- Consumes: Control API `0.1.0`
- Produces: installable skill doc for Hermes

- [ ] **Step 1: Write SKILL.md**

Must include:

- When to use (play FireRed in Pokemon Professor)  
- Base URL `http://127.0.0.1:7946`  
- Loop: GET `/state`, GET `/frame` (save image, vision), POST `/input` max 5 buttons  
- On 409: tell user mode is nudge/drive; wait  
- Mission: read current mission from user chat; do not invent ROM paths  
- Never download ROMs  
- FireRed tips adapted from pokemon-player (doors, ledges, short moves)  

- [ ] **Step 2: Contract test**

`tests/skill-protocol.test.ts` — use Control API from Task 3: simulate skill sequence observe → input → nudge 409 → resume → input. Assert statuses. This locks the skill against the server.

- [ ] **Step 3: Commit**

```powershell
npx vitest run tests/skill-protocol.test.ts
git add skills/pokemon-professor tests/skill-protocol.test.ts
git commit -m "feat: Hermes skill for Pokemon Professor Control API"
```

---

### Task 10: Nudge + mission wiring polish

**Files:**
- Modify: `components/override-controls.tsx`, `components/run-rail.tsx`, `components/chat-bar.tsx`
- Modify: `electron/main.ts` events

**Requirements:**

- Nudge sets mode `nudge`, appends `override_nudge_start`  
- Resume sets `agent`, appends `override_nudge_end`  
- Starting a mission while one active marks previous `paused` or `done` (choose **paused** if not explicitly completed)  
- UI shows current mode badge always visible  
- Chat system note when mode changes: "Agent tools frozen (nudge)"  

- [ ] **Step 1: Implement UI + event polish**  
- [ ] **Step 2: Manual checklist** — start mission, agent input via curl works, Nudge → curl 409, chat new mission, Resume → curl 200  
- [ ] **Step 3: Commit** `feat: nudge mission coach loop polish`

---

### Task 11: Drive mode polish + savestate resume

**Files:**
- Modify: Drive key map, focus trap in `live-view` / override
- Modify: run-rail Load list from GET `/saves` or IPC

**Requirements:**

- Drive: focus live view; keys Arrow*/Z/X/Enter/Shift → buttons; ignore chat focus  
- Escape or "Return to Agent" → mode agent  
- Resume Run: listRuns → select → load last savestate name if present → start backend with rom_path  

- [ ] **Step 1: Implement**  
- [ ] **Step 2: Manual** — Drive out of mock/mgba, save `pre_drive`, load after restart app  
- [ ] **Step 3: Commit** `feat: drive mode and savestate resume`

---

### Task 12: Alpha acceptance checklist + README

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/plans/alpha-checklist.md`

- [ ] **Step 1: Write README**

Cover:

- What it is  
- Prerequisites: Node 22+, Hermes gateway, legal FireRed ROM  
- `npm install`, `npm run dev:web`, electron dev  
- Control API port 7946  
- Skill install path  
- Legal: no ROMs  

- [ ] **Step 2: Run full Alpha checklist**

| # | Check | Pass? |
|---|--------|-------|
| 1 | `npm test` all unit/integration pass | |
| 2 | App starts on Windows | |
| 3 | mGBA download or mock path works | |
| 4 | Load FireRed (real) or mock ROM path | |
| 5 | Live frames visible | |
| 6 | Hermes chat message round-trip | |
| 7 | Skill or curl `POST /input` moves game | |
| 8 | Nudge blocks input (409) | |
| 9 | Drive human control works | |
| 10 | Savestate save/load/resume | |

- [ ] **Step 3: Commit** `docs: Alpha README and acceptance checklist`

**Alpha is done when checklist is fully pass on engineer machine.**

---

## Beta B tasks (after Alpha only)

Do not start until Task 12 checklist is green.

### Task 13: FireRed mission template pack

- Create: `data/missions/firered-templates.json`  
- Templates at minimum: `leave_pallet`, `parcel_oak`, `route1_viridian`, `brock_prep`  
- UI: template picker → `addMission` with `source: "template"`  
- Tests: each template has non-empty `id`, `title`, `prompt`

### Task 14: Autosave policy

- Autosave every 5 minutes while mode=agent and rom loaded  
- Autosave on mission end  
- Autosave immediately before entering Drive  
- Names: `auto_YYYYMMDD_HHMMSS`  
- Cap last 20 autosaves (delete older files + prune run.savestates)

### Task 15: FireRedState B-lite

- Extend Lua bridge `state` command  
- Fill optional fields: map/coords/party hp/in_battle/badges when known for US FireRed  
- `GET /state` returns partial object (not null) when any field known  
- Unit tests with fixture memory buffers if pure parsers exist; otherwise manual

### Task 16: Usage display (best-effort)

- If Hermes response includes usage tokens, show in chat footer  
- Never block on missing usage  

### Task 17: Beta polish

- Connection status UX for Hermes + Control API + mGBA  
- Legal ROM copy in onboarding  
- Optional: package electron-builder Windows installer  

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Local Agent Studio desktop | 5–6, 12 |
| mGBA sidecar + frames + input | 7 |
| First-run mGBA download | 7 |
| Local Hermes chat | 8 |
| Coach missions freeform | 4, 6, 10 |
| Nudge + Drive | 6, 10, 11 |
| Control API + skill | 3, 9 |
| Frame-first state stub | 2–3 (null state) |
| Run + savestate | 4, 11 |
| Best-effort usage | 16 (Beta) |
| Templates | 13 (Beta) |
| Autosave | 14 (Beta) |
| FireRedState B-lite | 15 (Beta) |
| No ROM ship | Global + README |
| Vertical slice order | Tasks 1→12 |

**Deferred intentionally:** online panel, credits, tournaments, chain, multi-game, in-process embed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-pokemon-professor-alpha.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
