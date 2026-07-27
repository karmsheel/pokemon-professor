import { describe, it, expect, afterAll } from "vitest";
import * as path from "path";
import { MgbaBackend } from "../electron/emulator/mgba-backend";
import { resolveForkExe } from "../electron/emulator/mgba-supervisor";

/**
 * End-to-end test of the Studio <-> headless mGBA fork integration.
 *
 * This drives the REAL MgbaBackend (the exact glue the Electron Studio uses)
 * against the compiled fork binary in vendor/mgba/build/mgba.exe. It lets
 * MgbaBackend spawn the fork headless (via resolveForkExe + spawnMgba) and
 * verifies the bridge protocol end-to-end: ping, state read, and frame capture.
 *
 * Requires the fork binary to be built (npm run fork:build or ninja in
 * vendor/mgba/build). Skips gracefully if no fork exe is present.
 */
const ROM = path.join(process.cwd(), ".local-roms", "PokemonFireRed.gba");

describe("Studio <-> headless mGBA fork (E2E)", () => {
  const backend = new MgbaBackend({
    exePath: resolveForkExe() ?? "",
    bridgePort: 7947,
    headless: true,
  });

  afterAll(async () => {
    await backend.stop().catch(() => undefined);
  });

  it("resolves the fork executable", () => {
    expect(resolveForkExe()).not.toBeNull();
  });

  it("spawns fork headless, ping + state + frame", async () => {
    if (!resolveForkExe()) {
      console.warn("SKIP: no fork exe at vendor/mgba/build/mgba.exe");
      return;
    }
    await backend.start(ROM, { preferAttach: false });
    expect(backend.isRomLoaded()).toBe(true);

    // ping
    const up = await backend.isBridgeUp(3000);
    expect(up).toBe(true);

    // state (FireRed RAM reader ported to C bridge)
    const state = await backend.getState();
    expect(state).not.toBeNull();
    // Fail loudly if the bridge returned an empty/malformed state object.
    expect(state).toHaveProperty("x");
    expect(state).toHaveProperty("y");
    expect(state).toHaveProperty("map_id");
    expect(Array.isArray((state as any).party)).toBe(true);
    console.log("[E2E] state:", JSON.stringify(state));

    // frame (PNG written by fork, returned as path -> read by Studio)
    const frame = await backend.getFramePng();
    expect(frame.width).toBe(240);
    expect(frame.height).toBe(160);
    expect(frame.data[0]).toBe(0x89); // PNG magic
    expect(frame.data.length).toBeGreaterThan(1000);
    console.log("[E2E] frame:", frame.width + "x" + frame.height, "bytes=" + frame.data.length);
  }, 90_000);
});
