// tests/hermes-settings.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERMES_SETTINGS,
  HERMES_DOCS_URL,
  isValidHermesBaseUrl,
  normalizeHermesSettings,
} from "../lib/hermes-settings";

describe("DEFAULT_HERMES_SETTINGS", () => {
  it("matches local gateway defaults", () => {
    expect(DEFAULT_HERMES_SETTINGS).toEqual({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "",
      model: "hermes-agent",
    });
  });
});

describe("normalizeHermesSettings", () => {
  it("fills defaults for empty input", () => {
    expect(normalizeHermesSettings(undefined)).toEqual(DEFAULT_HERMES_SETTINGS);
  });

  it("trims baseUrl and strips trailing slash", () => {
    const s = normalizeHermesSettings({
      baseUrl: "  http://127.0.0.1:8642/  ",
      apiKey: " k ",
      model: " m ",
    });
    expect(s.baseUrl).toBe("http://127.0.0.1:8642");
    expect(s.apiKey).toBe("k");
    expect(s.model).toBe("m");
  });

  it("falls back model to default when blank", () => {
    expect(normalizeHermesSettings({ model: "  " }).model).toBe("hermes-agent");
  });
});

describe("isValidHermesBaseUrl", () => {
  it("accepts http localhost", () => {
    expect(isValidHermesBaseUrl("http://127.0.0.1:8642")).toBe(true);
  });
  it("rejects empty and non-http", () => {
    expect(isValidHermesBaseUrl("")).toBe(false);
    expect(isValidHermesBaseUrl("ftp://x")).toBe(false);
    expect(isValidHermesBaseUrl("not-a-url")).toBe(false);
  });
});

describe("HERMES_DOCS_URL", () => {
  it("is https", () => {
    expect(HERMES_DOCS_URL.startsWith("https://")).toBe(true);
  });
});
