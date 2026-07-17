import * as fs from "fs";
import * as path from "path";
import type { Button, EmulatorBackend, FireRedState } from "../control-api/types";

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
    const file = resolveSaveFile(dir, name, ".mockstate");
    fs.writeFileSync(
      file,
      JSON.stringify({ frameId: this.frameId, pressCount: this.pressCount }),
      "utf8"
    );
    return file;
  }

  async loadState(name: string, dir: string): Promise<void> {
    const file = resolveSaveFile(dir, name, ".mockstate");
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
