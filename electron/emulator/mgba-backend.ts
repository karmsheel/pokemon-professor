import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import type { Button, EmulatorBackend, FireRedState } from "../control-api/types";
import {
  DEFAULT_BRIDGE_PORT,
  resolveBridgeScript,
  spawnMgba,
  type MgbaProcess,
} from "./mgba-supervisor";

/** Resolve save path and reject anything that escapes the save directory. */
function resolveSaveFile(dir: string, name: string, ext: string): string {
  const resolvedDir = path.resolve(dir);
  const file = path.resolve(resolvedDir, `${name}${ext}`);
  const prefix = resolvedDir.endsWith(path.sep)
    ? resolvedDir
    : resolvedDir + path.sep;
  if (file !== resolvedDir && !file.startsWith(prefix)) {
    throw new Error("invalid save path");
  }
  return file;
}

const REQUEST_TIMEOUT_MS = 5000;
const BRIDGE_WAIT_MS = 60_000;
const BRIDGE_POLL_MS = 500;

type BridgeOk = { ok: true; [k: string]: unknown };
type BridgeErr = { ok: false; error?: string };
type BridgeResponse = BridgeOk | BridgeErr;

export type MgbaBackendOptions = {
  exePath: string;
  /** Defaults to resolveBridgeScript() */
  scriptPath?: string;
  bridgePort?: number;
};

export type MgbaStartOptions = {
  /**
   * When true (default), if a Lua bridge is already listening, attach without
   * spawning a second mGBA. Use attachOnly to fail instead of spawning.
   */
  preferAttach?: boolean;
  /** Only attach; never spawn. Throws if bridge is down. */
  attachOnly?: boolean;
};

/**
 * EmulatorBackend that talks to mGBA via the Lua TCP bridge (port 7947).
 * `start` prefers attaching to an existing bridge; otherwise spawns mGBA.
 *
 * mGBA 0.10.x requires manually loading mgba-bridge.lua once per session:
 * Tools → Scripting → File → Load script…
 */
export class MgbaBackend implements EmulatorBackend {
  readonly kind = "mgba" as const;

  private loaded = false;
  private frameId = 0;
  private proc: MgbaProcess | null = null;
  /** True only when we spawned mGBA — do not kill an external process on stop. */
  private ownsProcess = false;
  private readonly exePath: string;
  private readonly scriptPath: string;
  private readonly bridgePort: number;

  constructor(opts: MgbaBackendOptions) {
    this.exePath = opts.exePath;
    this.scriptPath = opts.scriptPath ?? resolveBridgeScript();
    this.bridgePort = opts.bridgePort ?? DEFAULT_BRIDGE_PORT;
  }

  /** True if something is answering ping on the bridge port. */
  async isBridgeUp(timeoutMs = 800): Promise<boolean> {
    try {
      const res = await this.request({ cmd: "ping" }, timeoutMs);
      return res.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Attach to an already-running mGBA + loaded bridge. Does not spawn or kill.
   */
  /** Last connect mode from start/attach (for logging / UI). */
  lastConnectMode: "attach" | "spawn" | null = null;

  async attach(): Promise<void> {
    const up = await this.isBridgeUp(1500);
    if (!up) {
      throw new Error(
        `No mGBA bridge on 127.0.0.1:${this.bridgePort}. ` +
          `Load the script in mGBA: Tools → Scripting → File → Load script… → ${this.scriptPath}`
      );
    }
    // Detach from any prior owned process without killing external emulator
    this.proc = null;
    this.ownsProcess = false;
    this.loaded = true;
    this.frameId = 0;
    this.lastConnectMode = "attach";
  }

  async start(romPath: string, opts: MgbaStartOptions = {}): Promise<void> {
    const preferAttach = opts.preferAttach !== false;
    const attachOnly = opts.attachOnly === true;

    // Drop previous run state; only kill mGBA if we spawned it
    await this.stop().catch(() => undefined);

    if (preferAttach || attachOnly) {
      const up = await this.isBridgeUp(800);
      if (up) {
        this.ownsProcess = false;
        this.proc = null;
        this.loaded = true;
        this.frameId = 0;
        this.lastConnectMode = "attach";
        return;
      }
      if (attachOnly) {
        throw new Error(
          `No mGBA bridge on 127.0.0.1:${this.bridgePort}. ` +
            `Start mGBA with your ROM, then: Tools → Scripting → Load script → ${this.scriptPath}`
        );
      }
    }

    this.proc = await spawnMgba({
      exePath: this.exePath,
      romPath,
      scriptPath: this.scriptPath,
      bridgePort: this.bridgePort,
    });
    this.ownsProcess = true;

    try {
      await this.waitForBridge();
    } catch (e) {
      const hint =
        `Load the bridge script in mGBA: Tools → Scripting → File → Load script… → ${this.scriptPath}`;
      const msg = e instanceof Error ? e.message : String(e);
      await this.stop().catch(() => undefined);
      throw new Error(`${msg}\n${hint}`);
    }

    this.loaded = true;
    this.frameId = 0;
    this.lastConnectMode = "spawn";
  }

  async stop(): Promise<void> {
    this.loaded = false;
    if (this.ownsProcess && this.proc) {
      this.proc.stop();
    }
    this.proc = null;
    this.ownsProcess = false;
  }

  isRomLoaded(): boolean {
    return this.loaded;
  }

  getScriptPath(): string {
    return this.scriptPath;
  }

  getBridgePort(): number {
    return this.bridgePort;
  }

  async getFramePng(): Promise<{
    data: Buffer;
    width: number;
    height: number;
    frame_id: number;
  }> {
    this.assertLoaded();
    const res = (await this.request({ cmd: "frame" })) as (BridgeOk | BridgeErr) & {
      width?: number;
      height?: number;
      png_base64?: string;
      path?: string;
    };
    if (!res.ok) {
      throw new Error((res as BridgeErr).error || "frame failed");
    }
    let data: Buffer | null = null;
    if (typeof res.png_base64 === "string" && res.png_base64.length > 0) {
      data = Buffer.from(res.png_base64, "base64");
    } else if (typeof res.path === "string" && fs.existsSync(res.path)) {
      data = fs.readFileSync(res.path);
    }
    if (!data || data.length === 0) {
      throw new Error("frame response missing png data");
    }
    return {
      data,
      width: res.width ?? 240,
      height: res.height ?? 160,
      frame_id: this.frameId,
    };
  }

  async getState(): Promise<FireRedState | null> {
    // Memory reads for FireRed state are out of alpha scope for the bridge.
    return null;
  }

  async press(buttons: Button[]): Promise<void> {
    this.assertLoaded();
    const res = await this.request({ cmd: "input", buttons });
    if (!res.ok) {
      throw new Error((res as BridgeErr).error || "input failed");
    }
    this.frameId += 1;
  }

  async saveState(name: string, dir: string): Promise<string> {
    this.assertLoaded();
    fs.mkdirSync(dir, { recursive: true });
    const file = resolveSaveFile(dir, name, ".ss0");
    const res = await this.request({ cmd: "save", path: file });
    if (!res.ok) {
      throw new Error((res as BridgeErr).error || "save failed");
    }
    return file;
  }

  async loadState(name: string, dir: string): Promise<void> {
    this.assertLoaded();
    const file = resolveSaveFile(dir, name, ".ss0");
    if (!fs.existsSync(file)) {
      throw new Error(`savestate not found: ${file}`);
    }
    const res = await this.request({ cmd: "load", path: file });
    if (!res.ok) {
      throw new Error((res as BridgeErr).error || "load failed");
    }
  }

  async listSaves(dir: string): Promise<string[]> {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ss0"))
      .map((f) => f.replace(/\.ss0$/, ""));
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error("rom not loaded");
  }

  private async waitForBridge(): Promise<void> {
    const deadline = Date.now() + BRIDGE_WAIT_MS;
    let lastErr = "bridge not ready";
    while (Date.now() < deadline) {
      if (this.ownsProcess && this.proc?.child.exitCode != null) {
        throw new Error("mGBA process exited before bridge connected");
      }
      try {
        const res = await this.request({ cmd: "ping" }, 1500);
        if (res.ok) return;
        lastErr = (res as BridgeErr).error || "ping not ok";
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      await sleep(BRIDGE_POLL_MS);
    }
    throw new Error(
      `Timed out waiting for mGBA Lua bridge on 127.0.0.1:${this.bridgePort}: ${lastErr}`
    );
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<BridgeResponse> {
    const body = JSON.stringify(payload) + "\n";
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: this.bridgePort });
      let buf = "";
      let settled = false;

      const finish = (err?: Error, value?: BridgeResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value!);
      };

      const timer = setTimeout(() => {
        finish(new Error(`bridge request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(body);
      });
      socket.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl).replace(/\r$/, "");
        try {
          const parsed = JSON.parse(line) as BridgeResponse;
          finish(undefined, parsed);
        } catch (e) {
          finish(
            new Error(
              `invalid bridge JSON: ${e instanceof Error ? e.message : String(e)}`
            )
          );
        }
      });
      socket.on("error", (err) => {
        finish(err);
      });
      socket.on("close", () => {
        if (!settled) finish(new Error("bridge connection closed"));
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
