const path = require("path");
const fs = require("fs");
const os = require("os");
const { createControlServer } = require("../dist-electron/electron/control-api/server");
const { ModeMachine } = require("../dist-electron/electron/control-api/mode-machine");
const { MgbaBackend } = require("../dist-electron/electron/emulator/mgba-backend");
const { RunStore } = require("../dist-electron/electron/runs/store");

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  const results = [];
  const pass = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-fr-"));
  const store = new RunStore(path.join(tmp, "runs"));
  const mode = new ModeMachine();
  const rom = path.join(process.cwd(), ".local-roms", "PokemonFireRed.gba");
  const exe = path.join(
    process.env.APPDATA,
    "pokemon-professor",
    "mgba",
    "mGBA.exe"
  );

  // Attach to existing bridge (do not spawn/kill mGBA)
  const backend = new MgbaBackend({ exePath: exe, bridgePort: 7947 });
  backend.loaded = true; // attach mode
  backend.frameId = 0;

  let runId = null;
  const server = await createControlServer(
    {
      mode,
      backend,
      getRunId: () => runId,
      getSaveDir: () =>
        runId ? path.join(tmp, "runs", runId, "saves") : path.join(tmp, "orphan"),
    },
    { host: "127.0.0.1", port: 7948 }
  );
  const base = server.url;
  console.log("Control API (attach)", base);

  try {
    const run = store.create({ rom_path: rom });
    runId = run.id;
    store.appendEvent(run.id, { type: "run_started", detail: { attach: true } });
    pass("run created", true, runId);

    let r = await json(`${base}/health`);
    pass(
      "health mgba",
      r.status === 200 && r.body.rom_loaded && r.body.emulator === "mgba",
      JSON.stringify(r.body)
    );

    r = await json(`${base}/frame`);
    const frameOk =
      r.status === 200 &&
      r.body.mime === "image/png" &&
      typeof r.body.data === "string" &&
      r.body.data.length > 100;
    pass("frame from FireRed", frameOk, `len=${r.body.data?.length} id=${r.body.frame_id}`);
    if (frameOk) {
      const out = path.join(tmp, "frame.png");
      fs.writeFileSync(out, Buffer.from(r.body.data, "base64"));
      // also copy to project for inspection
      fs.copyFileSync(out, path.join(process.cwd(), "scripts", "last-firered-frame.png"));
      console.log("  wrote scripts/last-firered-frame.png");
    }

    r = await json(`${base}/state`);
    pass("state endpoint", r.status === 200);

    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    pass("agent input A", r.status === 200 && r.body.ok, JSON.stringify(r.body));

    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["RIGHT", "RIGHT", "UP"] }),
    });
    pass("agent sequential walk", r.status === 200 && r.body.executed?.length === 3);

    mode.set("nudge");
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    pass("nudge 409", r.status === 409);

    mode.set("drive");
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    pass("drive 409", r.status === 409);

    mode.set("agent");
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["B"] }),
    });
    pass("resume agent", r.status === 200);

    // Savestate on real mGBA
    r = await json(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha_test" }),
    });
    pass("save alpha_test", r.status === 200, r.body.path || r.body.error);
    if (r.status === 200) store.registerSavestate(runId, "alpha_test");

    r = await json(`${base}/saves`);
    pass("list saves", r.status === 200 && (r.body.saves || []).includes("alpha_test"), JSON.stringify(r.body));

    r = await json(`${base}/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha_test" }),
    });
    pass("load alpha_test", r.status === 200, r.body.error || "ok");

    // Hermes still ok
    try {
      const hr = await fetch("http://127.0.0.1:3848/api/hermes/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with exactly: READY" }],
        }),
      });
      const hb = await hr.json();
      pass("hermes proxy", hr.status === 200 && /READY/i.test(hb.content || ""), hb.content);
    } catch (e) {
      pass("hermes proxy", false, String(e.message || e));
    }

    const failed = results.filter((x) => !x.ok);
    console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  } finally {
    // Do NOT stop mGBA — attach mode only closes HTTP server
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
