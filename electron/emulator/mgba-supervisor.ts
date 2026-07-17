import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const DEFAULT_BRIDGE_PORT = 7947;

export type SpawnMgbaOpts = {
  exePath: string;
  romPath: string;
  scriptPath: string;
  bridgePort: number;
  /** When true, hide console window on Windows (default false so user can load script). */
  windowsHide?: boolean;
};

export type MgbaProcess = {
  stop: () => void;
  pid: number;
  child: ChildProcess;
  scriptPath: string;
  bridgePort: number;
};

/**
 * Resolve path to mgba-bridge.lua for dev (source) and built (dist-electron) layouts.
 */
export function resolveBridgeScript(fromDir?: string): string {
  const base = fromDir ?? __dirname;
  const candidates = [
    path.join(base, "mgba-bridge.lua"),
    path.join(base, "..", "..", "electron", "emulator", "mgba-bridge.lua"),
    path.join(process.cwd(), "electron", "emulator", "mgba-bridge.lua"),
    path.join(process.cwd(), "dist-electron", "emulator", "mgba-bridge.lua"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  throw new Error(
    `mgba-bridge.lua not found. Tried:\n${candidates.join("\n")}`
  );
}

/**
 * Spawn mGBA with a ROM.
 *
 * Note: mGBA 0.10.x has no CLI flag to autoload Lua scripts
 * (https://github.com/mgba-emu/mgba/issues/3289 — planned for 0.11).
 * After spawn, load `scriptPath` manually:
 *   Tools → Scripting → File → Load script…
 * The bridge then listens on bridgePort (default 7947).
 */
export async function spawnMgba(opts: SpawnMgbaOpts): Promise<MgbaProcess> {
  const { exePath, romPath, scriptPath, bridgePort } = opts;
  if (!fs.existsSync(exePath)) {
    throw new Error(`mGBA executable not found: ${exePath}`);
  }
  if (!fs.existsSync(romPath)) {
    throw new Error(`ROM not found: ${romPath}`);
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Bridge script not found: ${scriptPath}`);
  }

  // Args: ROM path. Future mGBA may accept a script flag; keep scriptPath for docs/UI.
  const args = [romPath];

  const child = spawn(exePath, args, {
    detached: false,
    windowsHide: opts.windowsHide ?? false,
    // stdout ignored so the pipe buffer cannot fill and hang mGBA
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      PP_MGBA_BRIDGE_PORT: String(bridgePort),
    },
  });

  if (child.pid == null) {
    throw new Error("failed to spawn mGBA (no pid)");
  }

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const stop = () => {
    if (child.killed) return;
    try {
      // Kill process tree on Windows
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  };

  // Surface early crash
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), 400);
    child.once("error", (err) => {
      clearTimeout(t);
      reject(new Error(`mGBA spawn error: ${err.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(t);
      if (code != null && code !== 0) {
        reject(
          new Error(
            `mGBA exited immediately with code ${code}. stderr: ${stderr.slice(0, 300)}`
          )
        );
      }
    });
  });

  return {
    stop,
    pid: child.pid,
    child,
    scriptPath: path.resolve(scriptPath),
    bridgePort,
  };
}
