import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensureMgbaBinary,
  isMgbaPresent,
  mgbaExePath,
  MgbaMissingError,
  MGBA_RELEASE,
} from "../electron/emulator/mgba-download";
import { resolveBridgeScript, DEFAULT_BRIDGE_PORT } from "../electron/emulator/mgba-supervisor";

describe("mgba-download helpers", () => {
  it("pins a specific release URL and sha256", () => {
    expect(MGBA_RELEASE.version).toBe("0.10.5");
    expect(MGBA_RELEASE.url).toContain("mGBA-0.10.5-win64.7z");
    expect(MGBA_RELEASE.sha256).toMatch(/^[a-f0-9]{64}$/i);
  });

  it("ensureMgbaBinary throws NEEDS_DOWNLOAD when missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mgba-"));
    expect(isMgbaPresent(tmp)).toBe(false);
    try {
      ensureMgbaBinary(tmp);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MgbaMissingError);
      expect((e as MgbaMissingError).code).toBe("NEEDS_DOWNLOAD");
    }
    expect(mgbaExePath(tmp)).toBe(path.join(tmp, "mgba", "mGBA.exe"));
  });

  it("resolveBridgeScript finds lua in repo", () => {
    const script = resolveBridgeScript();
    expect(script.endsWith("mgba-bridge.lua")).toBe(true);
    expect(fs.existsSync(script)).toBe(true);
    expect(DEFAULT_BRIDGE_PORT).toBe(7947);
  });
});
