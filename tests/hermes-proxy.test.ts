import { afterEach, describe, expect, it } from "vitest";
import { isHermesUnavailable, hermesConfig } from "../lib/hermes";
import { GET, POST } from "../app/api/hermes/chat/route";

const ENV_KEYS = ["HERMES_BASE_URL", "HERMES_API_KEY", "HERMES_MODEL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

function pushEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (!(k in savedEnv)) continue;
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete savedEnv[k];
  }
});

describe("hermesConfig", () => {
  it("defaults to local gateway on 8642", () => {
    pushEnv({
      HERMES_BASE_URL: undefined,
      HERMES_API_KEY: undefined,
      HERMES_MODEL: undefined,
    });
    const cfg = hermesConfig();
    expect(cfg.baseUrl).toBe("http://127.0.0.1:8642");
    expect(cfg.apiKey).toBe("");
    expect(cfg.model).toBe("hermes-agent");
  });
});

describe("isHermesUnavailable", () => {
  it("detects ECONNREFUSED on cause", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause: { code: string } }).cause = {
      code: "ECONNREFUSED",
    };
    expect(isHermesUnavailable(err)).toBe(true);
  });

  it("detects nested connection codes", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const outer = new TypeError("fetch failed");
    (outer as Error & { cause: Error }).cause = inner;
    expect(isHermesUnavailable(outer)).toBe(true);
  });

  it("does not treat generic errors as unavailable", () => {
    expect(isHermesUnavailable(new Error("model not found"))).toBe(false);
    expect(isHermesUnavailable(null)).toBe(false);
  });
});

describe("Hermes chat proxy routes", () => {
  it("GET returns 503 hermes_unavailable when gateway is down", async () => {
    pushEnv({ HERMES_BASE_URL: "http://127.0.0.1:59999" });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("hermes_unavailable");
    expect(body.hint).toMatch(/hermes gateway/i);
  });

  it("POST returns 503 hermes_unavailable when gateway is down", async () => {
    pushEnv({ HERMES_BASE_URL: "http://127.0.0.1:59999" });
    const req = new Request("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      error: "hermes_unavailable",
      hint: "Run hermes gateway",
    });
  });

  it("POST returns 400 when messages missing", async () => {
    const req = new Request("http://localhost/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("messages_required");
  });
});
