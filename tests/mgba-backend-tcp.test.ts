import { describe, it, expect, afterEach } from "vitest";
import * as net from "net";
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
        socket.on("data", (chunk: string) => {
          buf += chunk;
          const nl = buf.indexOf("\n");
          if (nl === -1) return;
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          const res = handler(line);
          socket.write(JSON.stringify(res) + "\n");
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
        return {
          ok: true,
          width: 240,
          height: 160,
          png_base64: png.toString("base64"),
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
    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-mgba-save-"));
    const file = await backend.saveState("slot1", dir);
    expect(file.endsWith("slot1.ss0")).toBe(true);

    // stop after attach must not throw (no owned process)
    await backend.stop();
    expect(backend.isRomLoaded()).toBe(false);
  });
});
