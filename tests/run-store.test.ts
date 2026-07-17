import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RunStore } from "../electron/runs/store";

describe("RunStore", () => {
  let root: string;
  let store: RunStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-runs-"));
    store = new RunStore(root);
  });

  it("creates and loads a run", () => {
    const run = store.create({ rom_path: "C:\\\\roms\\\\firered.gba" });
    expect(run.id).toBeTruthy();
    expect(run.status).toBe("active");
    expect(run.missions).toEqual([]);
    const loaded = store.get(run.id);
    expect(loaded?.rom_path).toContain("firered.gba");
  });

  it("adds freeform mission and events", () => {
    const run = store.create({ rom_path: "r.gba" });
    const mission = store.addMission(run.id, {
      prompt: "Leave Pallet Town and head north",
      source: "freeform",
    });
    expect(mission.status).toBe("active");
    store.appendEvent(run.id, {
      type: "mission_started",
      detail: { mission_id: mission.id },
    });
    store.updateMissionStatus(run.id, mission.id, "done");
    const final = store.get(run.id)!;
    expect(final.missions[0].status).toBe("done");
    expect(final.events.some((e) => e.type === "mission_started")).toBe(true);
  });

  it("pauses previous active mission when starting a new one", () => {
    const run = store.create({ rom_path: "r.gba" });
    const first = store.addMission(run.id, {
      prompt: "Leave Oak's lab",
      source: "freeform",
    });
    const second = store.addMission(run.id, {
      prompt: "Head to Route 1",
      source: "freeform",
    });
    const loaded = store.get(run.id)!;
    expect(loaded.missions.find((m) => m.id === first.id)?.status).toBe(
      "paused"
    );
    expect(loaded.missions.find((m) => m.id === second.id)?.status).toBe(
      "active"
    );
    // Done missions stay done when another starts
    store.updateMissionStatus(run.id, second.id, "done");
    const third = store.addMission(run.id, {
      prompt: "Find Viridian",
      source: "freeform",
    });
    const after = store.get(run.id)!;
    expect(after.missions.find((m) => m.id === second.id)?.status).toBe("done");
    expect(after.missions.find((m) => m.id === third.id)?.status).toBe(
      "active"
    );
  });

  it("lists runs newest first", () => {
    const a = store.create({ rom_path: "a.gba" });
    const b = store.create({ rom_path: "b.gba" });
    const list = store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
