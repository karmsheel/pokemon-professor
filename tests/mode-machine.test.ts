import { describe, it, expect } from "vitest";
import { ModeMachine } from "../electron/control-api/mode-machine";

describe("ModeMachine", () => {
  it("starts in agent mode", () => {
    const m = new ModeMachine();
    expect(m.get()).toBe("agent");
  });

  it("transitions to nudge and drive", () => {
    const m = new ModeMachine();
    m.set("nudge");
    expect(m.get()).toBe("nudge");
    m.set("drive");
    expect(m.get()).toBe("drive");
    m.set("agent");
    expect(m.get()).toBe("agent");
  });

  it("assertAgent throws when not agent", () => {
    const m = new ModeMachine();
    m.set("nudge");
    expect(() => m.assertAgent()).toThrow(/nudge/);
  });

  it("assertAgent succeeds in agent mode", () => {
    const m = new ModeMachine();
    expect(() => m.assertAgent()).not.toThrow();
  });
});
