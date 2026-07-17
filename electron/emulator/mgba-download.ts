import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { spawn } from "child_process";

/**
 * Pinned mGBA Windows x64 portable release.
 * Official portable ships as .7z (not zip) from GitHub / mgba.io S3 mirror.
 * SHA256 computed from the 0.10.5 win64 asset (14_156_919 bytes).
 */
export const MGBA_RELEASE = {
  version: "0.10.5",
  // Official asset: https://github.com/mgba-emu/mgba/releases/tag/0.10.5
  url: "https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z",
  sha256: "b497a57c7d9093834dadc64f33a90f7c411439c21fdb8a0143255a45ea37563a",
  archiveRoot: "mGBA-0.10.5-win64",
  exeName: "mGBA.exe",
} as const;

export class MgbaMissingError extends Error {
  readonly code = "NEEDS_DOWNLOAD" as const;

  constructor(message = "mGBA binary missing; download required") {
    super(message);
    this.name = "MgbaMissingError";
  }
}

export function mgbaDir(userData: string): string {
  return path.join(userData, "mgba");
}

export function mgbaExePath(userData: string): string {
  return path.join(mgbaDir(userData), MGBA_RELEASE.exeName);
}

/** Throws MgbaMissingError if userData/mgba/mGBA.exe is absent. */
export function ensureMgbaBinary(userData: string): string {
  const exe = mgbaExePath(userData);
  if (!fs.existsSync(exe)) {
    throw new MgbaMissingError(
      `mGBA not found at ${exe}. Call downloadMgba() or place mGBA.exe manually.`
    );
  }
  return exe;
}

export function isMgbaPresent(userData: string): boolean {
  return fs.existsSync(mgbaExePath(userData));
}

function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (current: string, redirects: number) => {
      if (redirects > 8) {
        reject(new Error("too many redirects downloading mGBA"));
        return;
      }
      const lib = current.startsWith("http://") ? http : https;
      const req = lib.get(current, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location, redirects + 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`download failed: HTTP ${status}`));
          return;
        }
        const total = Number(res.headers["content-length"] || 0);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0 && onProgress) onProgress(received / total);
        });
        res.pipe(out);
        out.on("finish", () => {
          out.close();
          resolve();
        });
        out.on("error", reject);
      });
      req.on("error", reject);
    };
    follow(url, 0);
  });
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Locate 7-Zip CLI for extracting official .7z portable builds. */
export function find7zExecutable(): string | null {
  const candidates = [
    process.env.SEVEN_ZIP_PATH,
    "7z",
    "7za",
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "7-Zip", "7z.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "7-Zip",
      "7z.exe"
    ),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c === "7z" || c === "7za") {
      // PATH lookup deferred to spawn; accept name and let extract try
      continue;
    }
    if (fs.existsSync(c)) return c;
  }
  // Prefer full path; fall back to bare name if nothing else
  return process.platform === "win32" ? "7z" : "7z";
}

function run7z(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to run 7-Zip (${exe}): ${err.message}. Install 7-Zip or set SEVEN_ZIP_PATH.`
        )
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`7-Zip exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function extract7z(archive: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const fullPaths = [
    process.env.SEVEN_ZIP_PATH,
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "7-Zip", "7z.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "7-Zip",
      "7z.exe"
    ),
  ].filter((p): p is string => typeof p === "string" && p.length > 0 && fs.existsSync(p));

  const tryOrder = [...fullPaths, "7z", "7za"];
  let lastErr: Error | null = null;
  for (const exe of tryOrder) {
    try {
      await run7z(exe, ["x", archive, `-o${destDir}`, "-y"]);
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("7-Zip extraction failed");
}

function copyDirFlat(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirFlat(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Download pinned mGBA release into userData/mgba/, verify sha256, extract.
 * Returns absolute path to mGBA.exe.
 */
export async function downloadMgba(
  userData: string,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const dir = mgbaDir(userData);
  fs.mkdirSync(dir, { recursive: true });

  const archivePath = path.join(dir, `mGBA-${MGBA_RELEASE.version}-win64.7z`);
  const extractTmp = path.join(dir, "_extract");

  await downloadToFile(MGBA_RELEASE.url, archivePath, onProgress);

  const digest = await sha256File(archivePath);
  if (digest.toLowerCase() !== MGBA_RELEASE.sha256.toLowerCase()) {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `mGBA checksum mismatch: expected ${MGBA_RELEASE.sha256}, got ${digest}`
    );
  }

  if (fs.existsSync(extractTmp)) {
    fs.rmSync(extractTmp, { recursive: true, force: true });
  }
  await extract7z(archivePath, extractTmp);

  const nested = path.join(extractTmp, MGBA_RELEASE.archiveRoot);
  const sourceRoot = fs.existsSync(nested) ? nested : extractTmp;
  const exeInSource = path.join(sourceRoot, MGBA_RELEASE.exeName);
  if (!fs.existsSync(exeInSource)) {
    throw new Error(
      `Extracted archive missing ${MGBA_RELEASE.exeName} under ${sourceRoot}`
    );
  }

  // Flatten into userData/mgba/ (keep licenses/scripts/shaders alongside exe)
  copyDirFlat(sourceRoot, dir);

  // Cleanup staging
  try {
    fs.rmSync(extractTmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(archivePath);
  } catch {
    /* ignore */
  }

  const exe = mgbaExePath(userData);
  if (!fs.existsSync(exe)) {
    throw new Error(`download finished but exe missing at ${exe}`);
  }
  return exe;
}
