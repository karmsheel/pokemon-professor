import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { Mission, MissionSource, MissionStatus, Run, RunEvent } from "./types";

export class RunStore {
  constructor(private rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private runDir(id: string) {
    return path.join(this.rootDir, id);
  }

  private runPath(id: string) {
    return path.join(this.runDir(id), "run.json");
  }

  create(opts: { rom_path: string }): Run {
    const id = randomUUID();
    const run: Run = {
      id,
      rom_path: opts.rom_path,
      created_at: new Date().toISOString(),
      status: "active",
      missions: [],
      events: [],
      savestates: [],
    };
    fs.mkdirSync(path.join(this.runDir(id), "saves"), { recursive: true });
    this.write(run);
    return run;
  }

  get(id: string): Run | null {
    const p = this.runPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as Run;
  }

  list(): Run[] {
    if (!fs.existsSync(this.rootDir)) return [];
    const ids = fs.readdirSync(this.rootDir);
    const runs = ids
      .map((id) => this.get(id))
      .filter((r): r is Run => r !== null);
    runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return runs;
  }

  addMission(
    runId: string,
    opts: { prompt: string; source: MissionSource }
  ): Mission {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    // Starting a new mission while one is active pauses the previous
    // (unless it was already done/aborted).
    for (const existing of run.missions) {
      if (existing.status === "active") {
        existing.status = "paused";
      }
    }
    const mission: Mission = {
      id: randomUUID(),
      prompt: opts.prompt,
      source: opts.source,
      status: "active",
      started_at: new Date().toISOString(),
    };
    run.missions.push(mission);
    this.write(run);
    return mission;
  }

  updateMissionStatus(
    runId: string,
    missionId: string,
    status: MissionStatus
  ): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    const m = run.missions.find((x) => x.id === missionId);
    if (!m) throw new Error("mission not found");
    m.status = status;
    if (status === "done" || status === "aborted") {
      m.ended_at = new Date().toISOString();
    }
    this.write(run);
  }

  appendEvent(
    runId: string,
    event: { type: string; detail?: Record<string, unknown> }
  ): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    const row: RunEvent = {
      at: new Date().toISOString(),
      type: event.type,
      detail: event.detail,
    };
    run.events.push(row);
    this.write(run);
  }

  registerSavestate(runId: string, name: string): void {
    const run = this.get(runId);
    if (!run) throw new Error("run not found");
    if (!run.savestates.includes(name)) run.savestates.push(name);
    this.write(run);
  }

  private write(run: Run): void {
    fs.mkdirSync(this.runDir(run.id), { recursive: true });
    fs.writeFileSync(this.runPath(run.id), JSON.stringify(run, null, 2), "utf8");
  }
}
