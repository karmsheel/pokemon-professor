import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { MgbaBackend } from "../electron/emulator/mgba-backend";

/**
 * Protocol-level test: fake Lua bridge TCP server.
 * Does not spawn real mGBA.
 */
describe("MgbaBackend TCP protocol", () => {
  let server: net.Server | null = null;
  let port = 0;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  });

  async function listenFakeBridge(
    handler: (line: string) => object
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      server = net.createServer((socket) => {
        let buf = "";
        socket.setEncoding("utf8");
        // Persistent connection: process every complete line (MgbaBackend reuses socket).
        socket.on("data", (chunk: string) => {
          buf += chunk;
          while (true) {
            const nl = buf.indexOf("\n");
            if (nl === -1) break;
            const line = buf.slice(0, nl).replace(/\r$/, "");
            buf = buf.slice(nl + 1);
            const res = handler(line);
            socket.write(JSON.stringify(res) + "\n");
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("no port"));
          return;
        }
        port = addr.port;
        resolve(port);
      });
      server.on("error", reject);
    });
  }

  it("getFramePng / press / save via bridge when already connected", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    await listenFakeBridge((line) => {
      const msg = JSON.parse(line) as { cmd: string; buttons?: string[]; path?: string };
      if (msg.cmd === "ping") return { ok: true, pong: true };
      if (msg.cmd === "frame") {
        // Path-only response (production bridge default).
        const framePath = path.join(os.tmpdir(), `pp-test-frame-${port}.png`);
        fs.writeFileSync(framePath, png);
        return {
          ok: true,
          width: 240,
          height: 160,
          path: framePath,
        };
      }
      if (msg.cmd === "input") {
        return { ok: true, executed: msg.buttons };
      }
      if (msg.cmd === "save") return { ok: true };
      if (msg.cmd === "load") return { ok: true };
      return { ok: false, error: "unknown" };
    });

    const backend = new MgbaBackend({
      exePath: "C:\\nonexistent\\mGBA.exe",
      scriptPath: __filename,
      bridgePort: port,
    });

    expect(await backend.isBridgeUp()).toBe(true);
    await backend.attach();
    expect(backend.lastConnectMode).toBe("attach");
    expect(backend.isRomLoaded()).toBe(true);

    // preferAttach start should attach without needing a real exe
    await backend.stop();
    await backend.start("C:\\fake\\firered.gba", {
      preferAttach: true,
    });
    expect(backend.lastConnectMode).toBe("attach");

    const frame = await backend.getFramePng();
    expect(frame.width).toBe(240);
    expect(frame.height).toBe(160);
    expect(frame.data[0]).toBe(0x89);

    await backend.press(["A", "RIGHT"]);

    // saveState uses real filesystem for path
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mgba-save-"));
    const file = await backend.saveState("slot1", dir);
    expect(file.endsWith("slot1.ss0")).toBe(true);

    // stop after attach must not throw (no owned process)
    await backend.stop();
    expect(backend.isRomLoaded()).toBe(false);
  });

  it("getState parses FireRed B-lite fields from the bridge state command", async () => {
    await listenFakeBridge((line) => {
      const msg = JSON.parse(line) as { cmd: string };
      if (msg.cmd === "ping") return { ok: true, pong: true };
      if (msg.cmd === "state") {
        return {
          ok: true,
          state: {
            x: 12,
            y: 14,
            map_id: 0x205, // Viridian (bank 2, map 5)
            in_battle: false,
            badges: 1,
            party: [
              { hp: 18, max_hp: 20, level: 6, status: "PSN", species_uncertain: true },
              { hp: 0, max_hp: 15, level: 4, status: "FRZ", species_uncertain: true },
            ],
          },
        };
      }
      return { ok: false, error: "unknown" };
    });

    const backend = new MgbaBackend({
      exePath: "C:\\\\nonexistent\\\\mGBA.exe",
      scriptPath: __filename,
      bridgePort: port,
    });
    await backend.attach();

    const state = await backend.getState();
    expect(state).not.toBeNull();
    expect(state!.x).toBe(12);
    expect(state!.y).toBe(14);
    expect(state!.map_id).toBe(0x205);
    expect(state!.badges).toBe(1);
    expect(state!.in_battle).toBe(false);
    expect(state!.party).toHaveLength(2);
    expect(state!.party![0].level).toBe(6);
    expect(state!.party![0].status).toBe("PSN");
    expect(state!.party![1].hp).toBe(0);
    // species intentionally not decoded from encrypted header
    expect(state!.party![0].species_uncertain).toBe(true);
    await backend.stop();
  });

  it("getState returns null when bridge reports failure", async () => {
    await listenFakeBridge((line) => {
      const msg = JSON.parse(line) as { cmd: string };
      if (msg.cmd === "ping") return { ok: true, pong: true };
      if (msg.cmd === "state") return { ok: false, error: "nope" };
      return { ok: false, error: "unknown" };
    });

    const backend = new MgbaBackend({
      exePath: "C:\\\\nonexistent\\\\mGBA.exe",
      scriptPath: __filename,
      bridgePort: port,
    });
    await backend.attach();
    expect(await backend.getState()).toBeNull();
    await backend.stop();
  });
});
