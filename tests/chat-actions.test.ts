// tests/chat-actions.test.ts
import { describe, expect, it } from "vitest";
import {
  gameStartedKickoffMessage,
  isStartGameIntent,
  romNeededMessage,
  romReadyMessage,
  welcomeMessage,
} from "../lib/chat-actions";

describe("isStartGameIntent", () => {
  it("matches common phrases case-insensitively", () => {
    expect(isStartGameIntent("start game")).toBe(true);
    expect(isStartGameIntent("  Start  ")).toBe(true);
    expect(isStartGameIntent("let's play")).toBe(true);
    expect(isStartGameIntent("lets play")).toBe(true);
  });
  it("rejects unrelated chat", () => {
    expect(isStartGameIntent("what should I name my rival?")).toBe(false);
    expect(isStartGameIntent("start the car")).toBe(false);
  });
});

describe("welcomeMessage", () => {
  it("mentions coach, Hermes, and legal ROM", () => {
    const w = welcomeMessage();
    expect(w.toLowerCase()).toMatch(/hermes|disciple|agent/);
    expect(w.toLowerCase()).toMatch(/rom/);
    expect(w.length).toBeGreaterThan(40);
  });
});

describe("rom helpers", () => {
  it("romNeededMessage prompts load", () => {
    expect(romNeededMessage().toLowerCase()).toMatch(/load|rom/);
  });
  it("romReadyMessage includes filename", () => {
    expect(romReadyMessage("PokemonFireRed.gba")).toContain("PokemonFireRed.gba");
  });
  it("kickoff tells agent to play from title", () => {
    expect(gameStartedKickoffMessage().toLowerCase()).toMatch(/title|play|start/);
  });
});
