/**
 * Wait for mGBA Lua bridge on 7947, then exercise Control-API-shaped
 * commands over the bridge (ping/frame/input) using MgbaBackend.
 *
 * Usage: node scripts/wait-bridge-and-smoke.cjs [timeoutSec]
 */
const net = require("net");
const path = require("path");
const { MgbaBackend } = require("../dist-electron/emulator/mgba-backend");

const timeoutSec = Number(process.argv[2] || 300);
const port = Number(process.env.PP_MGBA_BRIDGE_PORT || 7947);

function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(tryOnce, 1000);
        }
      });
    };
    tryOnce();
  });
}

function log(ok, name, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  return ok;
}

(async () => {
  console.log(`Waiting up to ${timeoutSec}s for bridge 127.0.0.1:${port} ...`);
  console.log("ACTION REQUIRED: In mGBA → Tools → Scripting → File → Load script →");
  console.log(
    path.resolve(__dirname, "../electron/emulator/mgba-bridge.lua")
  );

  await waitForPort("127.0.0.1", port, timeoutSec * 1000);
  console.log("Bridge is open — running smoke...");

  const backend = new MgbaBackend({ host: "127.0.0.1", port });
  // start() normally waits for bridge after spawn; here bridge already up
  // so we just connect by calling methods that use the TCP client.
  // MgbaBackend.start expects to spawn via supervisor — use low-level:
  // ensure connected via private path: call press/getFrame after faking loaded.

  // Minimal: use raw TCP for protocol smoke (does not require MgbaBackend.start)
  async function req(obj) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.write(JSON.stringify(obj) + "\n");
      });
      let buf = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl);
          socket.end();
          try {
            resolve(JSON.parse(line));
          } catch (e) {
            reject(e);
          }
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error("request timeout")), 10000);
    });
  }

  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    log(ok, name, detail);
  };

  let r = await req({ cmd: "ping" });
  check("ping", r.ok === true && r.pong === true, JSON.stringify(r));

  r = await req({ cmd: "frame" });
  check(
    "frame",
    r.ok === true &&
      r.width === 240 &&
      r.height === 160 &&
      (!!r.path || !!r.png_base64),
    `w=${r.width} h=${r.height} path=${r.path || "-"} b64len=${(r.png_base64 || "").length}`
  );

  r = await req({ cmd: "input", buttons: ["A"] });
  check("input A", r.ok === true, JSON.stringify(r));

  r = await req({ cmd: "input", buttons: ["RIGHT", "RIGHT", "A"] });
  check(
    "sequential RIGHT RIGHT A",
    r.ok === true && Array.isArray(r.executed) && r.executed.length === 3,
    JSON.stringify(r.executed)
  );

  const failed = results.filter((x) => !x).length;
  console.log(`\nSUMMARY ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("SMOKE_FAILED", e.message || e);
  process.exit(1);
});
