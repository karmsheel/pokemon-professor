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

  it("lists runs newest first", () => {
    const a = store.create({ rom_path: "a.gba" });
    const b = store.create({ rom_path: "b.gba" });
    const list = store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
