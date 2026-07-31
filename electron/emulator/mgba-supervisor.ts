import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const DEFAULT_BRIDGE_PORT = 7947;

export type SpawnMgbaOpts = {
  exePath: string;
  romPath: string;
  scriptPath: string;
  bridgePort: number;
  /** When true, spawn the Pokemon Professor mGBA fork headless (no window,
   *  bridge auto-starts — no manual Lua load). Mutually exclusive with script. */
  headless?: boolean;
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
    `mgba-bridge.lua not found. Tried:\\n${candidates.join("\\n")}`
  );
}

/**
 * Prepend MSYS2 ucrt64 bin to PATH on Windows when present so the headless
 * fork (dynamically linked against that runtime) can load its DLLs.
 */
export function pathWithUcrt64(envPath: string | undefined): string {
  const bin = "C:\\msys64\\ucrt64\\bin";
  if (process.platform === "win32" && fs.existsSync(bin)) {
    return `${bin}${path.delimiter}${envPath ?? ""}`;
  }
  return envPath ?? "";
}

/**
 * Resolve the Pokemon Professor headless fork executable.
 * Priority:
 *   1. PP_MGBA_FORK_EXE env
 *   2. userData/mgba-fork/mGBA.exe (packaged / downloaded install)
 *   3. vendored build dir (dev) / dist-electron build dir
 * Returns null if no fork binary is present (caller falls back to stock mGBA).
 */
export function resolveForkExe(userData?: string): string | null {
  if (process.env.PP_MGBA_FORK_EXE && fs.existsSync(process.env.PP_MGBA_FORK_EXE)) {
    return process.env.PP_MGBA_FORK_EXE;
  }
  const candidates: string[] = [];
  if (userData) {
    candidates.push(path.join(userData, "mgba-fork", "mGBA.exe"));
  }
  // __dirname is dist-electron/electron/emulator (or electron/emulator in source) —
  // need three levels up from dist layout to reach repo root vendor/.
  // Prefer mGBA.exe (actual build product); keep mgba.exe for case-sensitive FS.
  candidates.push(
    path.join(process.cwd(), "vendor", "mgba", "build", "mGBA.exe"),
    path.join(process.cwd(), "vendor", "mgba", "build", "mgba.exe"),
    path.join(__dirname, "..", "..", "..", "vendor", "mgba", "build", "mGBA.exe"),
    path.join(__dirname, "..", "..", "..", "vendor", "mgba", "build", "mgba.exe"),
    path.join(__dirname, "..", "..", "vendor", "mgba", "build", "mGBA.exe"),
    path.join(__dirname, "..", "..", "vendor", "mgba", "build", "mgba.exe"),
    path.join(process.cwd(), "dist-electron", "vendor", "mgba", "build", "mGBA.exe"),
    path.join(process.cwd(), "dist-electron", "vendor", "mgba", "build", "mgba.exe"),
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return null;
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
  const { exePath, romPath, scriptPath, bridgePort, headless } = opts;
  if (!fs.existsSync(exePath)) {
    throw new Error(`mGBA executable not found: ${exePath}`);
  }
  if (!fs.existsSync(romPath)) {
    throw new Error(`ROM not found: ${romPath}`);
  }
  if (headless) {
    // Fork: bridge auto-starts, no Lua script needed.
    // Prepend ucrt64 so MSYS2-linked fork DLLs resolve without a special shell.
    const args = ["--agent-headless", romPath, "--agent-bridge=" + bridgePort];
    const child = spawn(exePath, args, {
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        PATH: pathWithUcrt64(process.env.PATH),
        PP_MGBA_BRIDGE_PORT: String(bridgePort),
      },
    });
    if (child.pid == null) {
      throw new Error("failed to spawn headless mGBA (no pid)");
    }
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const stop = () => {
      if (child.killed) return;
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try { child.kill(); } catch { /* ignore */ }
      }
    };
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), 400);
      child.once("error", (err) => {
        clearTimeout(t);
        reject(new Error(`headless mGBA spawn error: ${err.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(t);
        if (code != null && code !== 0) {
          reject(new Error(`headless mGBA exited immediately with code ${code}. stderr: ${stderr.slice(0, 300)}`));
        }
      });
    });
    return { stop, pid: child.pid, child, scriptPath: "", bridgePort };
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
