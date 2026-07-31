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
