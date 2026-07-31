# Agent-First Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an agent-driven Studio UX: hard Hermes connect gate (Retry + Open docs only), chat-led Load ROM / Start game, headless game boot in **agent** mode, and sparse agent narration — no terminal or external mGBA in the happy path.

**Architecture:** Electron owns ROM path, emulator spawn (headless fork preferred), mode, and persisted settings. Next.js chat proxy accepts per-request Hermes config from the renderer (gate settings), not only env vars. Chat UI is the primary control surface (CTAs); Run rail becomes secondary/Advanced. Hermes skill remains Control API-only; Studio bootstraps the game then hands play to the agent.

**Tech Stack:** Electron main/preload IPC, Next.js 15 App Router, React 19 client components, Vitest, existing Control API (`:7946`) + MgbaBackend/headless fork.

## Global Constraints

- **Hermes hard gate (option 3):** no Skip / offline-play primary path; gate actions are **Connect/Test**, **Retry**, **Open Hermes docs** only.
- **Default mode after Start game:** `agent`.
- **ROM legal:** user-supplied `.gba` only; never download or invent ROM paths.
- **Professor owns mode:** agent never `POST /mode`; Studio calls `studio:setMode` / Control API.
- **Happy-path emulator:** headless fork (`--agent-headless`); stock mGBA + Lua is Advanced/fallback only.
- **Platform:** Windows primary; Node 22+; Control API localhost-only.
- **Docs constant:** Hermes docs URL `https://hermes-agent.nousresearch.com/` (open via `shell.openExternal` in Electron; `window.open` in browser).
- Follow existing patterns in `electron/main.ts`, `lib/hermes.ts`, `components/chat-bar.tsx`, `components/run-rail.tsx`.
- TDD where pure logic exists; manual Electron check for full gate → Start game flow.
- Commit after each task.

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/hermes-settings.ts` | Types + defaults + validate Hermes connection settings (pure) |
| `lib/session-store.ts` | Types + pure helpers for last ROM path / session flags (pure; file IO stays Electron) |
| `lib/chat-actions.ts` | Pure parsers: detect “start game” intent; welcome copy constants |
| `electron/settings-store.ts` | Read/write `userData/studio-settings.json` |
| `electron/main.ts` | IPC for settings, last ROM, startGame (createRun + agent mode), openExternal docs |
| `electron/preload.ts` + `types/studio.d.ts` | Expose new `window.studio` methods |
| `app/api/hermes/chat/route.ts` | Accept optional Hermes config override from request |
| `components/hermes-connect-gate.tsx` | Full-screen hard gate UI |
| `components/chat-bar.tsx` | Welcome, CTAs, start-game intent, reconnect strip |
| `app/page.tsx` | Gate vs main shell; pass session props into ChatBar/LiveView |
| `skills/pokemon-professor/SKILL.md` | Sparse narration policy |
| `tests/hermes-settings.test.ts` | Settings validation |
| `tests/chat-actions.test.ts` | Start-game intent + welcome |
| `tests/hermes-proxy.test.ts` | Proxy override + health |
| `docs/superpowers/specs/2026-07-31-agent-first-studio-design.md` | Spec (already committed) |

---

### Task 1: Hermes settings types and validation (pure)

**Files:**
- Create: `lib/hermes-settings.ts`
- Create: `tests/hermes-settings.test.ts`

**Interfaces:**
- Produces:
  - `export type HermesSettings = { baseUrl: string; apiKey: string; model: string }`
  - `export const DEFAULT_HERMES_SETTINGS: HermesSettings`
  - `export const HERMES_DOCS_URL = "https://hermes-agent.nousresearch.com/"`
  - `export function normalizeHermesSettings(input: Partial<HermesSettings> | null | undefined): HermesSettings`
  - `export function isValidHermesBaseUrl(url: string): boolean` — must be `http:` or `https:` with host

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hermes-settings.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERMES_SETTINGS,
  HERMES_DOCS_URL,
  isValidHermesBaseUrl,
  normalizeHermesSettings,
} from "../lib/hermes-settings";

describe("DEFAULT_HERMES_SETTINGS", () => {
  it("matches local gateway defaults", () => {
    expect(DEFAULT_HERMES_SETTINGS).toEqual({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "",
      model: "hermes-agent",
    });
  });
});

describe("normalizeHermesSettings", () => {
  it("fills defaults for empty input", () => {
    expect(normalizeHermesSettings(undefined)).toEqual(DEFAULT_HERMES_SETTINGS);
  });

  it("trims baseUrl and strips trailing slash", () => {
    const s = normalizeHermesSettings({
      baseUrl: "  http://127.0.0.1:8642/  ",
      apiKey: " k ",
      model: " m ",
    });
    expect(s.baseUrl).toBe("http://127.0.0.1:8642");
    expect(s.apiKey).toBe("k");
    expect(s.model).toBe("m");
  });

  it("falls back model to default when blank", () => {
    expect(normalizeHermesSettings({ model: "  " }).model).toBe("hermes-agent");
  });
});

describe("isValidHermesBaseUrl", () => {
  it("accepts http localhost", () => {
    expect(isValidHermesBaseUrl("http://127.0.0.1:8642")).toBe(true);
  });
  it("rejects empty and non-http", () => {
    expect(isValidHermesBaseUrl("")).toBe(false);
    expect(isValidHermesBaseUrl("ftp://x")).toBe(false);
    expect(isValidHermesBaseUrl("not-a-url")).toBe(false);
  });
});

describe("HERMES_DOCS_URL", () => {
  it("is https", () => {
    expect(HERMES_DOCS_URL.startsWith("https://")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/hermes-settings.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `lib/hermes-settings.ts`**

```ts
export type HermesSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export const DEFAULT_HERMES_SETTINGS: HermesSettings = {
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "",
  model: "hermes-agent",
};

export const HERMES_DOCS_URL = "https://hermes-agent.nousresearch.com/";

export function normalizeHermesSettings(
  input: Partial<HermesSettings> | null | undefined
): HermesSettings {
  const baseUrl = (input?.baseUrl ?? DEFAULT_HERMES_SETTINGS.baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const apiKey = (input?.apiKey ?? DEFAULT_HERMES_SETTINGS.apiKey).trim();
  const modelRaw = (input?.model ?? DEFAULT_HERMES_SETTINGS.model).trim();
  const model = modelRaw || DEFAULT_HERMES_SETTINGS.model;
  return {
    baseUrl: baseUrl || DEFAULT_HERMES_SETTINGS.baseUrl,
    apiKey,
    model,
  };
}

export function isValidHermesBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/hermes-settings.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/hermes-settings.ts tests/hermes-settings.test.ts
git commit -m "feat: Hermes settings types and validation"
```

---

### Task 2: Chat action helpers (welcome copy + start intent)

**Files:**
- Create: `lib/chat-actions.ts`
- Create: `tests/chat-actions.test.ts`

**Interfaces:**
- Produces:
  - `export function isStartGameIntent(text: string): boolean`
  - `export function welcomeMessage(): string` — deterministic studio welcome
  - `export function romNeededMessage(): string`
  - `export function romReadyMessage(romFileName: string): string`
  - `export function gameStartedKickoffMessage(): string`

- [ ] **Step 1: Write failing tests**

```ts
// tests/chat-actions.test.ts
import { describe, expect, it } from "vitest";
import {
  gameStartedKickoffMessage,
  isStartGameIntent,
  romNeededMessage,
  romReadyMessage,
  welcomeMessage,
} from "../lib/chat-actions";

describe("isStartGameIntent", () => {
  it("matches common phrases case-insensitively", () => {
    expect(isStartGameIntent("start game")).toBe(true);
    expect(isStartGameIntent("  Start  ")).toBe(true);
    expect(isStartGameIntent("let's play")).toBe(true);
    expect(isStartGameIntent("lets play")).toBe(true);
  });
  it("rejects unrelated chat", () => {
    expect(isStartGameIntent("what should I name my rival?")).toBe(false);
    expect(isStartGameIntent("start the car")).toBe(false);
  });
});

describe("welcomeMessage", () => {
  it("mentions coach, Hermes, and legal ROM", () => {
    const w = welcomeMessage();
    expect(w.toLowerCase()).toMatch(/hermes|disciple|agent/);
    expect(w.toLowerCase()).toMatch(/rom/);
    expect(w.length).toBeGreaterThan(40);
  });
});

describe("rom helpers", () => {
  it("romNeededMessage prompts load", () => {
    expect(romNeededMessage().toLowerCase()).toMatch(/load|rom/);
  });
  it("romReadyMessage includes filename", () => {
    expect(romReadyMessage("PokemonFireRed.gba")).toContain("PokemonFireRed.gba");
  });
  it("kickoff tells agent to play from title", () => {
    expect(gameStartedKickoffMessage().toLowerCase()).toMatch(/title|play|start/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/chat-actions.test.ts`

- [ ] **Step 3: Implement `lib/chat-actions.ts`**

```ts
export function isStartGameIntent(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/g, "");
  if (!t) return false;
  if (t === "start" || t === "start game" || t === "start the game") return true;
  if (t === "let's play" || t === "lets play" || t === "let us play") return true;
  if (t === "begin" || t === "begin game") return true;
  return false;
}

export function welcomeMessage(): string {
  return [
    "Welcome, Professor. I'm your disciple via Hermes — I'll play Pokémon FireRed while you coach.",
    "You must provide your own legally obtained FireRed .gba ROM (this app never ships or downloads ROMs).",
    "Next: load your ROM if needed, then use Start game. I'll take control in agent mode and check in when something important happens or I'm stuck.",
  ].join(" ");
}

export function romNeededMessage(): string {
  return "No FireRed ROM is loaded yet. Use Load FireRed ROM… to pick your .gba file.";
}

export function romReadyMessage(romFileName: string): string {
  return `ROM ready: ${romFileName}. Click Start game when you want me to begin.`;
}

export function gameStartedKickoffMessage(): string {
  return "Game started. Take it from the title screen: observe via the Control API, play in agent mode, and message me only for progress, trouble, or when I ask.";
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/chat-actions.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/chat-actions.ts tests/chat-actions.test.ts
git commit -m "feat: chat welcome copy and start-game intent helpers"
```

---

### Task 3: Electron settings store + IPC (persist Hermes + last ROM)

**Files:**
- Create: `electron/settings-store.ts`
- Modify: `electron/main.ts` (register IPC handlers)
- Modify: `electron/preload.ts`
- Modify: `types/studio.d.ts`
- Create: `tests/settings-store.test.ts` (pure read/write with temp dir)

**Interfaces:**
- Produces (main process):
  - `type StudioSettings = { hermes: HermesSettings; lastRomPath: string | null }`
  - `loadStudioSettings(userData: string): StudioSettings`
  - `saveStudioSettings(userData: string, settings: StudioSettings): void`
- IPC:
  - `studio:getSettings` → `StudioSettings`
  - `studio:setHermesSettings` → `(partial) => StudioSettings`
  - `studio:setLastRomPath` → `(path: string | null) => StudioSettings`
  - `studio:openHermesDocs` → `void` (`shell.openExternal(HERMES_DOCS_URL)`)
  - `studio:probeHermes` → `{ ok: boolean; error?: string; hint?: string }` using stored or passed settings (fetch `${base}/health` with 3s timeout)

- [ ] **Step 1: Write failing test for settings store file round-trip**

```ts
// tests/settings-store.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadStudioSettings,
  saveStudioSettings,
  defaultStudioSettings,
} from "../electron/settings-store";

let tmp: string;

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("settings-store", () => {
  it("returns defaults when file missing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-settings-"));
    const s = loadStudioSettings(tmp);
    expect(s).toEqual(defaultStudioSettings());
  });

  it("round-trips hermes + lastRomPath", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-settings-"));
    saveStudioSettings(tmp, {
      hermes: {
        baseUrl: "http://127.0.0.1:9000",
        apiKey: "secret",
        model: "hermes-agent",
      },
      lastRomPath: "C:\\\\roms\\\\firered.gba",
    });
    const s = loadStudioSettings(tmp);
    expect(s.hermes.baseUrl).toBe("http://127.0.0.1:9000");
    expect(s.hermes.apiKey).toBe("secret");
    expect(s.lastRomPath).toBe("C:\\\\roms\\\\firered.gba");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/settings-store.test.ts`

- [ ] **Step 3: Implement `electron/settings-store.ts`**

```ts
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_HERMES_SETTINGS,
  normalizeHermesSettings,
  type HermesSettings,
} from "../lib/hermes-settings";

export type StudioSettings = {
  hermes: HermesSettings;
  lastRomPath: string | null;
};

export function defaultStudioSettings(): StudioSettings {
  return { hermes: { ...DEFAULT_HERMES_SETTINGS }, lastRomPath: null };
}

function settingsPath(userData: string): string {
  return path.join(userData, "studio-settings.json");
}

export function loadStudioSettings(userData: string): StudioSettings {
  const p = settingsPath(userData);
  if (!fs.existsSync(p)) return defaultStudioSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<StudioSettings>;
    return {
      hermes: normalizeHermesSettings(raw.hermes),
      lastRomPath:
        typeof raw.lastRomPath === "string" && raw.lastRomPath.trim()
          ? raw.lastRomPath
          : null,
    };
  } catch {
    return defaultStudioSettings();
  }
}

export function saveStudioSettings(userData: string, settings: StudioSettings): void {
  fs.mkdirSync(userData, { recursive: true });
  const out: StudioSettings = {
    hermes: normalizeHermesSettings(settings.hermes),
    lastRomPath: settings.lastRomPath,
  };
  fs.writeFileSync(settingsPath(userData), JSON.stringify(out, null, 2), "utf8");
}
```

- [ ] **Step 4: Wire IPC in `main.ts`** (add near other `ipcMain.handle` blocks)

Import `shell` from `electron`, settings store, `HERMES_DOCS_URL`, `isValidHermesBaseUrl`, `normalizeHermesSettings`, `isHermesUnavailable` (from a small shared path — if importing `lib/hermes` from electron is awkward for compile, duplicate a 10-line probe in main or import via relative path; prefer `../lib/hermes` only if `tsconfig.electron` includes it — **if not**, implement probe inline in main using `fetch` Node 22).

Handlers:

```ts
ipcMain.handle("studio:getSettings", () => loadStudioSettings(app.getPath("userData")));

ipcMain.handle("studio:setHermesSettings", (_e, partial: Partial<HermesSettings>) => {
  const userData = app.getPath("userData");
  const cur = loadStudioSettings(userData);
  const hermes = normalizeHermesSettings({ ...cur.hermes, ...partial });
  if (!isValidHermesBaseUrl(hermes.baseUrl)) {
    throw new Error("Invalid Hermes base URL (use http:// or https://)");
  }
  const next = { ...cur, hermes };
  saveStudioSettings(userData, next);
  return next;
});

ipcMain.handle("studio:setLastRomPath", (_e, romPath: string | null) => {
  const userData = app.getPath("userData");
  const cur = loadStudioSettings(userData);
  const next = {
    ...cur,
    lastRomPath: romPath && romPath.trim() ? romPath : null,
  };
  saveStudioSettings(userData, next);
  return next;
});

ipcMain.handle("studio:openHermesDocs", async () => {
  await shell.openExternal(HERMES_DOCS_URL);
});

ipcMain.handle("studio:probeHermes", async (_e, override?: Partial<HermesSettings>) => {
  const cur = loadStudioSettings(app.getPath("userData"));
  const hermes = normalizeHermesSettings({ ...cur.hermes, ...override });
  if (!isValidHermesBaseUrl(hermes.baseUrl)) {
    return { ok: false, error: "invalid_url", hint: "Enter a valid http(s) Hermes URL" };
  }
  try {
    const res = await fetch(`${hermes.baseUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
      headers: hermes.apiKey ? { Authorization: `Bearer ${hermes.apiKey}` } : undefined,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: "hermes_unavailable",
        hint: "Hermes returned an error — is the gateway running?",
      };
    }
    return { ok: true as const };
  } catch {
    return {
      ok: false,
      error: "hermes_unavailable",
      hint: "Cannot reach Hermes — start the gateway, then Retry",
    };
  }
});
```

Also update `studio:pickRom` success path callers later; for now when pick returns path, ChatBar will call `setLastRomPath`.

- [ ] **Step 5: Preload + types**

```ts
// preload additions
getSettings: () => ipcRenderer.invoke("studio:getSettings"),
setHermesSettings: (partial: object) => ipcRenderer.invoke("studio:setHermesSettings", partial),
setLastRomPath: (romPath: string | null) => ipcRenderer.invoke("studio:setLastRomPath", romPath),
openHermesDocs: () => ipcRenderer.invoke("studio:openHermesDocs"),
probeHermes: (override?: object) => ipcRenderer.invoke("studio:probeHermes", override),
```

Mirror exact types in `types/studio.d.ts`.

- [ ] **Step 6: Ensure electron build includes new file**

Run: `npm run build:electron`  
Expected: exit 0

- [ ] **Step 7: Run unit tests**

Run: `npx vitest run tests/settings-store.test.ts tests/hermes-settings.test.ts`  
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add electron/settings-store.ts electron/main.ts electron/preload.ts types/studio.d.ts tests/settings-store.test.ts
git commit -m "feat: persist studio Hermes settings and last ROM path"
```

**Note:** If `tsconfig.electron.json` cannot import from `lib/`, either add `"../lib/**/*.ts"` to include or copy normalize imports via relative path already used pattern — check `tsconfig.electron.json` and fix include rather than duplicating logic.

---

### Task 4: Hermes proxy accepts config override

**Files:**
- Modify: `app/api/hermes/chat/route.ts`
- Modify: `lib/hermes.ts` (optional helper `resolveHermesConfig(override?)`)
- Modify: `tests/hermes-proxy.test.ts`

**Interfaces:**
- GET: optional query `baseUrl`, `apiKey`, `model` → probe that gateway
- POST body: optional `hermes?: Partial<HermesSettings>` → use for completion request
- Still defaults to env via `hermesConfig()` when omitted

- [ ] **Step 1: Extend tests in `tests/hermes-proxy.test.ts`**

Add:

```ts
describe("hermes config override helper", () => {
  it("resolveHermesConfig merges override over defaults", async () => {
    const { resolveHermesConfig } = await import("../lib/hermes");
    const c = resolveHermesConfig({ baseUrl: "http://127.0.0.1:9999/" });
    expect(c.baseUrl).toBe("http://127.0.0.1:9999");
  });
});
```

If full route tests already mock fetch, add one that POST with `hermes.baseUrl` calls that host (mock `global.fetch`).

- [ ] **Step 2: Implement `resolveHermesConfig` in `lib/hermes.ts`**

```ts
import { normalizeHermesSettings, type HermesSettings } from "./hermes-settings";

export function resolveHermesConfig(
  override?: Partial<HermesSettings> | null
): HermesConfig {
  const env = hermesConfig();
  const n = normalizeHermesSettings({
    baseUrl: override?.baseUrl ?? env.baseUrl,
    apiKey: override?.apiKey ?? env.apiKey,
    model: override?.model ?? env.model,
  });
  return n;
}
```

(`HermesConfig` and `HermesSettings` are identical shape — keep both aliases or unify to one type export.)

- [ ] **Step 3: Update GET/POST in route to use `resolveHermesConfig`**

GET:

```ts
const url = new URL(request.url);
const override = {
  baseUrl: url.searchParams.get("baseUrl") ?? undefined,
  apiKey: url.searchParams.get("apiKey") ?? undefined,
  model: url.searchParams.get("model") ?? undefined,
};
const config = resolveHermesConfig(override);
```

POST: parse `body.hermes` and pass to `resolveHermesConfig`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/hermes-proxy.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/hermes.ts app/api/hermes/chat/route.ts tests/hermes-proxy.test.ts
git commit -m "feat: Hermes chat proxy accepts settings override"
```

---

### Task 5: Hermes connect gate UI (hard gate)

**Files:**
- Create: `components/hermes-connect-gate.tsx`
- Modify: `app/globals.css` (gate layout classes)
- Modify: `app/page.tsx` (show gate until connected session flag)

**Interfaces:**
- Props:
  ```ts
  type HermesConnectGateProps = {
    initial: HermesSettings;
    onConnected: (settings: HermesSettings) => void;
  };
  ```
- Behavior:
  - Fields: baseUrl, apiKey (password), model
  - Buttons: **Connect** (primary), **Retry** (same as Connect when failed), **Open Hermes docs**
  - **No** Skip / Continue offline
  - Probe: prefer `window.studio.probeHermes(settings)` when available; else `GET /api/hermes/chat?baseUrl=...`
  - On success: if studio, `setHermesSettings`; call `onConnected`
  - On failure: show `hint` from probe

- [ ] **Step 1: Implement gate component** (UI-focused; no separate component test required if pure helpers already covered — manual check listed below)

Skeleton:

```tsx
"use client";

import { useState } from "react";
import {
  HERMES_DOCS_URL,
  isValidHermesBaseUrl,
  normalizeHermesSettings,
  type HermesSettings,
} from "@/lib/hermes-settings";

export function HermesConnectGate({
  initial,
  onConnected,
}: {
  initial: HermesSettings;
  onConnected: (s: HermesSettings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const settings = normalizeHermesSettings({ baseUrl, apiKey, model });
    if (!isValidHermesBaseUrl(settings.baseUrl)) {
      setError("Enter a valid http(s) URL for the Hermes gateway.");
      setBusy(false);
      return;
    }
    try {
      let ok = false;
      let hint = "Cannot reach Hermes — start the gateway, then Retry";
      if (window.studio?.probeHermes) {
        const r = await window.studio.probeHermes(settings);
        ok = r.ok;
        if (!ok) hint = r.hint || hint;
        if (ok && window.studio.setHermesSettings) {
          await window.studio.setHermesSettings(settings);
        }
      } else {
        const q = new URLSearchParams({ baseUrl: settings.baseUrl });
        if (settings.apiKey) q.set("apiKey", settings.apiKey);
        if (settings.model) q.set("model", settings.model);
        const res = await fetch(`/api/hermes/chat?${q}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        ok = res.ok && data.ok !== false;
        if (!ok) hint = data.hint || hint;
      }
      if (!ok) {
        setError(hint);
        return;
      }
      onConnected(settings);
    } catch {
      setError("Cannot reach Hermes — start the gateway, then Retry");
    } finally {
      setBusy(false);
    }
  };

  const openDocs = async () => {
    if (window.studio?.openHermesDocs) await window.studio.openHermesDocs();
    else window.open(HERMES_DOCS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="hermes-gate">
      <div className="hermes-gate-card panel">
        <h1>Connect Hermes</h1>
        <p className="muted">
          Pokemon Professor is agent-driven. Connect your local Hermes gateway to continue.
        </p>
        {/* fields: baseUrl, apiKey, model */}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>
            {error ? "Retry" : "Connect"}
          </button>
          <button type="button" disabled={busy} onClick={() => void openDocs()}>
            Open Hermes docs
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS** — full viewport centered card (`.hermes-gate`, `.hermes-gate-card`)

- [ ] **Step 3: Wire `app/page.tsx`**

State:

```ts
const [hermesReady, setHermesReady] = useState(false);
const [hermesSettings, setHermesSettings] = useState(DEFAULT_HERMES_SETTINGS);
```

On mount: if `window.studio?.getSettings`, load settings; optionally auto-probe once — **if probe fails, stay on gate** (do not auto-enter main shell). If probe succeeds, set `hermesReady true`.

Render:

```tsx
if (!hermesReady) {
  return (
    <HermesConnectGate
      initial={hermesSettings}
      onConnected={(s) => {
        setHermesSettings(s);
        setHermesReady(true);
      }}
    />
  );
}
// existing studio-root …
```

Pass `hermesSettings` into `ChatBar` for proxy overrides (Task 6).

- [ ] **Step 4: Manual check**

1. Stop Hermes gateway → launch UI → gate shows → Connect fails → Retry + Open docs only.  
2. Start Hermes → Connect → main shell appears.

- [ ] **Step 5: Commit**

```bash
git add components/hermes-connect-gate.tsx app/page.tsx app/globals.css
git commit -m "feat: Hermes hard connect gate (Retry + Open docs)"
```

---

### Task 6: Chat-led onboarding + CTAs + start intent

**Files:**
- Modify: `components/chat-bar.tsx`
- Modify: `app/page.tsx` (pass rom/run callbacks and hermes settings)

**Interfaces:**
- Extend `ChatBarProps`:
  ```ts
  type ChatBarProps = {
    mode?: ControlMode;
    variant?: "sidebar" | "bar";
    hermesSettings: HermesSettings;
    romPath: string | null;
    runId: string | null;
    onRomLoaded: (path: string) => void;
    onRunStarted: (run: { id: string }, romPath: string) => void;
    onHermesLost?: () => void; // optional: return to gate
  };
  ```
- On mount (once when connected): push `welcomeMessage()` system message; then either `romNeededMessage()` or `romReadyMessage(basename)`.
- Render CTA row above composer:
  - **Load FireRed ROM…** → `studio.pickRom` → `setLastRomPath` → `onRomLoaded`
  - **Start game** → call start handler (Task 7 wires full start; for this task call stub or partial)
- On send: if `isStartGameIntent(draft)`, run Start game instead of (or before) normal chat when no need to also chat — **prefer: run start, do not send phrase to Hermes as a user mission**
- All Hermes fetch calls include `hermes: hermesSettings` in POST body; GET health with query params
- If health fails after was connected: show **reconnect strip** with Retry + Open docs (calls probe; on fail `onHermesLost?.()` or local strip only — prefer strip without full unmount unless product wants hard gate again; **spec:** reconnect strip for later disconnect during session)

- [ ] **Step 1: Refactor chat health poll and POST to pass hermesSettings**

```ts
const q = new URLSearchParams({ baseUrl: hermesSettings.baseUrl, model: hermesSettings.model });
if (hermesSettings.apiKey) q.set("apiKey", hermesSettings.apiKey);
const res = await fetch(`/api/hermes/chat?${q}`, { cache: "no-store" });
```

POST:

```ts
body: JSON.stringify({
  messages: [...],
  model: hermesSettings.model,
  hermes: hermesSettings,
})
```

- [ ] **Step 2: Welcome + CTA UI**

On first mount after hermesReady:

```ts
useEffect(() => {
  setMessages([
    { id: newId(), role: "system", content: welcomeMessage() },
    {
      id: newId(),
      role: "system",
      content: romPath
        ? romReadyMessage(romPath.split(/[/\\]/).pop() || romPath)
        : romNeededMessage(),
    },
  ]);
  // run once — use ref for "welcomed"
}, []);
```

CTA buttons disabled when `busy` or missing studio for ROM actions in browser-only mode (show muted: “Open the desktop app to load ROMs”).

- [ ] **Step 3: Wire page props**

Load `lastRomPath` from settings into `romPath` state if file path known (Electron can validate exists in main later; for now set path and let Start fail clearly if missing).

- [ ] **Step 4: Manual check** — connect → welcome + ROM CTA visible; pick ROM updates messages.

- [ ] **Step 5: Commit**

```bash
git add components/chat-bar.tsx app/page.tsx
git commit -m "feat: chat-led welcome, Load ROM CTA, Hermes settings on proxy"
```

---

### Task 7: Start game IPC (createRun + agent mode + kickoff)

**Files:**
- Modify: `electron/main.ts` — add `studio:startGame`
- Modify: `electron/preload.ts`, `types/studio.d.ts`
- Modify: `components/chat-bar.tsx` — wire Start game button + intent
- Modify: `skills/pokemon-professor/SKILL.md` — narration section (can split to Task 9 if preferred; include minimal kickoff here)

**Interfaces:**
- `studio:startGame(romPath?: string | null)` returns:
  ```ts
  {
    id: string;
    rom_path: string;
    connect: "attach" | "spawn" | "mock";
    mode: "agent";
  }
  ```
- Implementation:
  1. Resolve romPath = arg || settings.lastRomPath; throw if missing
  2. `fs.existsSync` or throw “ROM file not found”
  3. Reuse `startOrAttachBackend` / `createRun` logic
  4. `mode.set("agent")`
  5. `saveStudioSettings` lastRomPath
  6. Return run + mode

- [ ] **Step 1: Add handler**

```ts
ipcMain.handle("studio:startGame", async (_e, romPathArg?: string | null) => {
  const userData = app.getPath("userData");
  const settings = loadStudioSettings(userData);
  const romPath = (romPathArg && romPathArg.trim()) || settings.lastRomPath;
  if (!romPath) throw new Error("No ROM selected. Load a FireRed .gba first.");
  if (!fs.existsSync(romPath)) {
    throw new Error(`ROM not found: ${romPath}. Load a FireRed .gba again.`);
  }
  const run = store.create({ rom_path: romPath });
  currentRunId = run.id;
  const connect = await startOrAttachBackend(romPath);
  if (backend.isRomLoaded()) capture.start();
  mode.set("agent");
  saveStudioSettings(userData, { ...settings, lastRomPath: romPath });
  store.appendEvent(run.id, {
    type: "run_started",
    detail: { emulator: backend.kind, connect, source: "start_game" },
  });
  return { ...run, rom_path: romPath, connect, mode: "agent" as const };
});
```

- [ ] **Step 2: ChatBar `startGame` function**

```ts
const startGame = async () => {
  if (!window.studio?.startGame) throw new Error("Start game requires the desktop app");
  setSending(true);
  try {
    const result = await window.studio.startGame(romPath);
    onRunStarted({ id: result.id }, result.rom_path);
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "system", content: `Run ${result.id.slice(0, 8)}… · ${result.connect} · mode agent` },
      { id: newId(), role: "user", content: gameStartedKickoffMessage() },
    ]);
    // Immediately POST kickoff to Hermes so agent begins (include system skill hint)
    await sendToHermes(/* messages including kickoff */);
  } catch (e) {
    setError(e instanceof Error ? e.message : "Start game failed");
  } finally {
    setSending(false);
  }
};
```

Ensure `sendToHermes` reuses existing POST path with `hermesSettings`.

- [ ] **Step 3: Prefer fork** — confirm `createBackend` still prefers `resolveForkExe()`; if Start fails without fork, surface error string in chat (no terminal).

- [ ] **Step 4: Manual check with ROM + fork**

1. Connect Hermes  
2. Load ROM  
3. Start game → Live view frames  
4. `GET http://127.0.0.1:7946/health` → `rom_loaded: true`, `mode: "agent"`  
5. Hermes receives kickoff (chat shows assistant reply or tool activity)

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts types/studio.d.ts components/chat-bar.tsx
git commit -m "feat: Start game boots ROM in agent mode from chat"
```

---

### Task 8: Headless fork packaging for Start game reliability

**Files:**
- Modify: `electron/emulator/mgba-supervisor.ts` (`resolveForkExe` also check userData)
- Modify: `electron/main.ts` / download path — on first Start game if no fork, try copy from `vendor/mgba/build/mGBA.exe` into userData OR run existing download + document fork:download
- Modify: `scripts/download-fork.cjs` if needed to land in userData layout
- Optional: `electron/emulator/fork-install.ts` — `ensureForkBinary(userData): string | null`

**Goal:** Start game does not require developer cwd to contain `vendor/mgba/build/mGBA.exe` only; resolve order:

1. `PP_MGBA_FORK_EXE`  
2. `userData/mgba-fork/mGBA.exe`  
3. `vendor/mgba/build/mGBA.exe` (dev)  
4. else fall back stock mGBA (Advanced) with clear system message that manual bridge may be required

- [ ] **Step 1: Implement `ensureStudioMgba` resolution helper**

```ts
// electron/emulator/fork-resolve.ts
export function resolveForkExe(userData?: string): string | null {
  // existing candidates + path.join(userData, "mgba-fork", "mGBA.exe")
}
```

Update `mgba-supervisor.resolveForkExe` to accept optional userData or call shared helper.

- [ ] **Step 2: On `startGame`, if no fork and stock missing, call `downloadMgba` only as last resort and post system message:**  
  `"Using standard mGBA. If the live view stays blank, use Advanced attach instructions."`  
  Prefer shipping/copying fork when present next to app.

- [ ] **Step 3: Windows PATH for ucrt64** — when spawning headless fork, prepend `C:\\msys64\\ucrt64\\bin` to `env.PATH` if that directory exists (mirror e2e test). Implement in `spawnMgba` headless branch.

```ts
function pathWithUcrt64(envPath: string | undefined): string {
  const bin = "C:\\msys64\\ucrt64\\bin";
  if (process.platform === "win32" && fs.existsSync(bin)) {
    return `${bin}${path.delimiter}${envPath ?? ""}`;
  }
  return envPath ?? "";
}
```

- [ ] **Step 4: Run e2e if ROM present**

Run: `npx vitest run tests/studio-fork-e2e.test.ts`  
Expected: PASS or skip without fork/ROM

- [ ] **Step 5: Commit**

```bash
git add electron/emulator/mgba-supervisor.ts electron/main.ts
git commit -m "fix: resolve headless fork from userData and fix spawn PATH"
```

---

### Task 9: Sparse narration policy in skill + reconnect polish

**Files:**
- Modify: `skills/pokemon-professor/SKILL.md`
- Modify: `components/chat-bar.tsx` (reconnect strip if not done)
- Modify: `components/override-controls.tsx` copy if needed (“Rescue” framing)
- Modify: `components/run-rail.tsx` — add muted “Advanced” label; do not remove yet (YAGNI: leave functional)

- [ ] **Step 1: Add skill section “Narration policy”**

Insert after Mission Coaching:

```markdown
## Narration policy (chat with the Professor)

Message the user **sparingly** in studio chat:

**Do message when:**
- Session start / title screen plan
- Clear progress (new town, badge, major story beat)
- Stuck: same screen or failed plan 3+ times — say what you tried and ask for a nudge
- Control API 409 (nudge/drive) — tell them tools are frozen
- They asked a question

**Do not message when:**
- Every 2–4 button batch succeeds as expected
- Routine grass steps, repeated “I see …” observations

Prefer playing over talking. Short updates (1–3 sentences).
```

- [ ] **Step 2: Reconnect strip UI** when Hermes poll fails after gate passed:

```tsx
{!connected ? (
  <div className="reconnect-strip">
    <span>Hermes disconnected</span>
    <button type="button" onClick={() => void retryProbe()}>Retry</button>
    <button type="button" onClick={() => void openDocs()}>Open Hermes docs</button>
  </div>
) : null}
```

Do not offer Skip. Disable Start game + send while disconnected (or allow send to surface 503 with same strip).

- [ ] **Step 3: Footer copy** — OverrideControls labels can stay; add title tooltips: “Rescue: pause agent and re-prompt” / “Rescue: you control the game”.

- [ ] **Step 4: Commit**

```bash
git add skills/pokemon-professor/SKILL.md components/chat-bar.tsx components/override-controls.tsx components/run-rail.tsx
git commit -m "feat: sparse agent narration policy and Hermes reconnect strip"
```

---

### Task 10: MVP acceptance pass + README touch

**Files:**
- Modify: `README.md` (Quick start → agent-first flow)
- Modify: `docs/superpowers/plans/alpha-checklist.md` or add agent-first checklist section in plan notes

- [ ] **Step 1: Update README Quick start**

```markdown
## Quick start (agent-first)

1. Install and run local Hermes gateway (`hermes gateway` — see Hermes docs).
2. `npm install`
3. `npm run dev:web` and `npm run dev:electron`
4. **Connect Hermes** in the gate (Retry / Open docs if offline).
5. In chat: **Load FireRed ROM…** → **Start game**
6. Watch Live view; coach in chat; Nudge/Drive only if the agent is stuck.

Legal: provide your own FireRed `.gba`. The app never ships ROMs.
```

- [ ] **Step 2: Run full unit suite**

Run: `npm test`  
Expected: all existing + new tests PASS (e2e may skip)

- [ ] **Step 3: Manual MVP script** (checklist in commit message or alpha-test-log)

1. Gate blocks without Hermes  
2. Open docs works  
3. Connect succeeds  
4. Welcome + ROM CTA  
5. Start game → frames + mode agent  
6. Chat kickoff  
7. Nudge → input 409  
8. Drive → keys work → back to agent  

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/alpha-checklist.md
git commit -m "docs: agent-first quick start and MVP acceptance notes"
```

---

## Spec coverage checklist

| Spec requirement | Task(s) |
|------------------|---------|
| Hermes hard gate, Retry + Open docs only | 5, 9 |
| Persist Hermes settings | 1, 3 |
| Welcome + discussion | 2, 6 |
| Load ROM CTA / remember path | 3, 6, 7 |
| Start game from chat / intent | 2, 6, 7 |
| Agent mode default on start | 7 |
| Headless / no external mGBA happy path | 7, 8 |
| Sparse narration | 9 |
| Nudge/Drive rescue framing | 9 |
| Legal ROM rules | 2, 6, 7, 10 |
| Chat proxy uses user settings | 4, 6 |
| MVP acceptance | 10 |

---

## Out of plan (explicit)

- Full mGBA menu parity  
- In-process libmgba embed  
- Bundling Hermes binary  
- Removing Run rail entirely (left as Advanced)  
- Multi-agent UX  

---

## Execution notes

- Prefer **subagent-driven-development**: one task per subagent, review between tasks.  
- Electron tasks need `npm run build:electron` before manual UI checks.  
- Keep `dev:web` running for renderer; restart Electron after main/preload changes.  
- If `tsconfig.electron` cannot import `lib/`, add include path in the task that first needs it (Task 3) rather than forking logic.
