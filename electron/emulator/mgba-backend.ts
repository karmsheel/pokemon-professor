import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import type { Button, EmulatorBackend, FireRedState, FireRedPartyMember } from "../control-api/types";
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

  /**
   * Persistent bridge socket + serialized command queue.
   * Opening a new TCP connection per frame at ~20Hz races mGBA's Lua socket
   * layer ("bridge connection closed") and produces intermittent /frame 500s.
   */
  private bridgeSocket: net.Socket | null = null;
  private bridgeBuf = "";
  private bridgePending: {
    resolve: (v: BridgeResponse) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Tail of the command queue (always settles). */
  private bridgeChain: Promise<void> = Promise.resolve();

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
    this.dropBridgeSocket();
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
    // Path-only frame response (default) — no base64 over the bridge TCP JSON.
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
    // Prefer filesystem path (fast path from bridge). Fall back to embedded b64.
    if (typeof res.path === "string" && res.path.length > 0) {
      if (fs.existsSync(res.path)) {
        data = fs.readFileSync(res.path);
      }
    }
    if (
      (!data || data.length === 0) &&
      typeof res.png_base64 === "string" &&
      res.png_base64.length > 0
    ) {
      data = Buffer.from(res.png_base64, "base64");
    }
    if (!data || data.length === 0) {
      throw new Error("frame response missing png data");
    }
    // Reject truncated / non-PNG so the UI never paints a broken image (zoom flicker).
    if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
      throw new Error("frame data is not a valid PNG");
    }
    // Each capture is a new live screenshot — advance id so UI can track freshness.
    this.frameId += 1;
    return {
      data,
      width: res.width ?? 240,
      height: res.height ?? 160,
      frame_id: this.frameId,
    };
  }

  async getState(): Promise<FireRedState | null> {
    if (!this.loaded) return null;
    let res: { ok?: boolean; state?: Record<string, unknown>; error?: string };
    try {
      res = (await this.request({ cmd: "state" })) as typeof res;
    } catch (e) {
      // Bridge unreachable — keep /state alive (frame still works).
      console.warn("[pp] getState bridge error:", (e as Error).message);
      return null;
    }
    if (!res?.ok || !res.state) return null;

    const raw = res.state as Record<string, unknown>;
    const state: FireRedState = {};

    // x/y
    if (typeof raw.x === "number") state.x = raw.x;
    if (typeof raw.y === "number") state.y = raw.y;

    // map_id (merge bank+number)
    if (typeof raw.map_id === "number") state.map_id = raw.map_id;

    // in_battle
    if (typeof raw.in_battle === "boolean") state.in_battle = raw.in_battle;

    // badges (bitfield → count, keep raw too)
    if (typeof raw.badges === "number") {
      state.badges = raw.badges;
    }

    // money deferred: XOR-encrypted, base offset uncertain for FR.
    // party (B-lite: hp/max_hp/level/status from unencrypted tail; species
    // from encrypted header is NOT decoded → species_uncertain=true)
    if (Array.isArray(raw.party)) {
      const party: FireRedPartyMember[] = [];
      for (const m of raw.party as Array<Record<string, unknown>>) {
        const member: FireRedPartyMember = {};
        if (typeof m.hp === "number") member.hp = m.hp;
        if (typeof m.max_hp === "number") member.max_hp = m.max_hp;
        if (typeof m.level === "number") member.level = m.level;
        if (typeof m.status === "string") member.status = m.status;
        member.species_uncertain = true;
        party.push(member);
      }
      if (party.length > 0) state.party = party;
    }

    return state;
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

  private dropBridgeSocket(): void {
    const sock = this.bridgeSocket;
    this.bridgeSocket = null;
    this.bridgeBuf = "";
    if (this.bridgePending) {
      const p = this.bridgePending;
      this.bridgePending = null;
      clearTimeout(p.timer);
      p.reject(new Error("bridge connection closed"));
    }
    if (sock) {
      sock.removeAllListeners();
      sock.destroy();
    }
  }

  private ensureBridgeSocket(): Promise<net.Socket> {
    if (this.bridgeSocket && !this.bridgeSocket.destroyed) {
      return Promise.resolve(this.bridgeSocket);
    }
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: this.bridgePort });
      let opened = false;

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        opened = true;
        this.bridgeSocket = socket;
        this.bridgeBuf = "";
        resolve(socket);
      });
      socket.on("data", (chunk: string) => {
        this.bridgeBuf += chunk;
        while (true) {
          const nl = this.bridgeBuf.indexOf("\n");
          if (nl === -1) break;
          const line = this.bridgeBuf.slice(0, nl).replace(/\r$/, "");
          this.bridgeBuf = this.bridgeBuf.slice(nl + 1);
          if (!this.bridgePending) continue;
          const pending = this.bridgePending;
          this.bridgePending = null;
          clearTimeout(pending.timer);
          try {
            pending.resolve(JSON.parse(line) as BridgeResponse);
          } catch (e) {
            pending.reject(
              new Error(
                `invalid bridge JSON: ${e instanceof Error ? e.message : String(e)}`
              )
            );
          }
        }
      });
      socket.on("error", (err) => {
        if (!opened) {
          reject(err);
          return;
        }
        this.dropBridgeSocket();
      });
      socket.on("close", () => {
        if (this.bridgeSocket === socket) {
          this.dropBridgeSocket();
        } else if (!opened) {
          reject(new Error("bridge connection closed"));
        }
      });
    });
  }

  /**
   * Send one line-delimited JSON command and wait for one response line.
   * All commands share a single persistent socket and run one-at-a-time.
   */
  private request(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<BridgeResponse> {
    const run = async (): Promise<BridgeResponse> => {
      const attempt = async (): Promise<BridgeResponse> => {
        const socket = await this.ensureBridgeSocket();
        if (this.bridgePending) {
          throw new Error("bridge command already in flight");
        }
        return new Promise<BridgeResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (this.bridgePending) {
              this.bridgePending = null;
              this.dropBridgeSocket();
              reject(
                new Error(`bridge request timed out after ${timeoutMs}ms`)
              );
            }
          }, timeoutMs);
          this.bridgePending = { resolve, reject, timer };
          try {
            socket.write(JSON.stringify(payload) + "\n");
          } catch (e) {
            this.bridgePending = null;
            clearTimeout(timer);
            this.dropBridgeSocket();
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      };

      try {
        return await attempt();
      } catch (e) {
        // One reconnect+retry for transient close races under load.
        this.dropBridgeSocket();
        return await attempt();
      }
    };

    const next = this.bridgeChain.then(run, run);
    this.bridgeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
