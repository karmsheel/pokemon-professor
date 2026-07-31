const path = require("path");
const fs = require("fs");
const os = require("os");
const { createControlServer } = require("../dist-electron/electron/control-api/server");
const { ModeMachine } = require("../dist-electron/electron/control-api/mode-machine");
const { MockBackend } = require("../dist-electron/electron/emulator/mock-backend");
const { RunStore } = require("../dist-electron/electron/runs/store");

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

(async () => {
  const results = [];
  const pass = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-smoke-"));
  const store = new RunStore(path.join(tmp, "runs"));
  const backend = new MockBackend();
  const mode = new ModeMachine();
  let runId = null;

  const server = await createControlServer(
    {
      mode,
      backend,
      getRunId: () => runId,
      getSaveDir: () =>
        runId ? path.join(tmp, "runs", runId, "saves") : path.join(tmp, "orphan"),
    },
    { host: "127.0.0.1", port: 0 }
  );
  const base = server.url;

  try {
    const run = store.create({ rom_path: path.join(tmp, "firered.gba") });
    runId = run.id;
    await backend.start(run.rom_path);
    store.appendEvent(run.id, { type: "run_started" });
    pass("start run", true, runId);

    let r = await json(`${base}/health`);
    pass(
      "health after start",
      r.status === 200 && r.body.rom_loaded === true && r.body.emulator === "mock",
      JSON.stringify(r.body)
    );

    r = await json(`${base}/frame`);
    pass(
      "frame png",
      r.status === 200 && r.body.mime === "image/png" && typeof r.body.data === "string",
      `frame_id=${r.body.frame_id}`
    );

    r = await json(`${base}/state`);
    pass("state stub", r.status === 200 && r.body.state === null);

    const mission = store.addMission(runId, {
      prompt: "Leave Pallet Town",
      source: "freeform",
    });
    store.appendEvent(runId, {
      type: "mission_started",
      detail: { mission_id: mission.id },
    });
    pass("mission freeform", !!mission.id);

    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["RIGHT", "A"] }),
    });
    pass("agent input 200", r.status === 200 && r.body.ok === true);

    mode.set("nudge");
    store.appendEvent(runId, { type: "override_nudge_start" });
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    pass("nudge blocks input 409", r.status === 409 && r.body.mode === "nudge");

    mode.set("agent");
    store.appendEvent(runId, { type: "override_nudge_end" });
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A"] }),
    });
    pass("resume agent input 200", r.status === 200);

    mode.set("drive");
    store.appendEvent(runId, { type: "mode_drive" });
    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["UP"] }),
    });
    pass("drive blocks agent input 409", r.status === 409);
    const before = await json(`${base}/frame`);
    await backend.press(["UP", "RIGHT"]);
    const after = await json(`${base}/frame`);
    pass(
      "drive press advances frame",
      after.body.frame_id > before.body.frame_id,
      `${before.body.frame_id}->${after.body.frame_id}`
    );

    mode.set("agent");
    store.appendEvent(runId, { type: "override_drive_end" });

    r = await json(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "pre_drive" }),
    });
    pass("save pre_drive", r.status === 200);
    store.registerSavestate(runId, "pre_drive");
    await backend.press(["DOWN"]);
    r = await json(`${base}/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "pre_drive" }),
    });
    pass("load pre_drive", r.status === 200);
    r = await json(`${base}/saves`);
    pass("list saves", r.status === 200 && r.body.saves.includes("pre_drive"));

    const loaded = store.get(runId);
    const last = loaded.savestates[loaded.savestates.length - 1];
    await backend.stop();
    await backend.start(loaded.rom_path);
    await backend.loadState(last, path.join(tmp, "runs", runId, "saves"));
    pass("resume run + last savestate", last === "pre_drive");

    r = await json(`${base}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buttons: ["A", "A", "A", "A", "A", "A"] }),
    });
    pass("max 5 buttons 400", r.status === 400);

    const failed = results.filter((x) => !x.ok);
    console.log("\nSUMMARY", `${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  } finally {
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
