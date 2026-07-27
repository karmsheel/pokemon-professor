import type { IncomingMessage, ServerResponse } from "http";
import type { ControlContext } from "./context";
import {
  API_VERSION,
  SAVE_NAME_RE,
  VALID_BUTTONS,
  type Button,
  type ControlMode,
} from "./types";

function corsHeaders(): Record<string, string> {
  // Studio UI is served from Next (e.g. :3848) and calls Control API (:7946).
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    "access-control-expose-headers":
      "x-frame-id, x-frame-width, x-frame-height, x-captured-at, content-type",
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    ...corsHeaders(),
  });
  res.end(data);
}

/** Prefer binary PNG for live view: ?raw=1 or Accept: image/png (not star/star). */
function wantsRawPng(req: IncomingMessage, url: URL): boolean {
  if (url.searchParams.get("raw") === "1") return true;
  const accept = (req.headers.accept || "").toLowerCase();
  if (!accept || accept === "*/*") return false;
  // image/png preferred and JSON not preferred
  if (accept.includes("image/png") && !accept.includes("application/json")) {
    return true;
  }
  return false;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function handleRequest(
  ctx: ControlContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = req.method || "GET";
  const p = url.pathname;

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (method === "GET" && p === "/health") {
      return send(res, 200, {
        ok: true,
        api_version: API_VERSION,
        mode: ctx.mode.get(),
        emulator: ctx.backend.isRomLoaded() ? ctx.backend.kind : "none",
        rom_loaded: ctx.backend.isRomLoaded(),
        run_id: ctx.getRunId(),
      });
    }

    // GET /frame — buffer read (no getFramePng)
    if (method === "GET" && p === "/frame") {
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const frame = ctx.capture.getLatest();
      if (!frame) {
        return send(res, 404, { ok: false, error: "no frame yet" });
      }
      if (wantsRawPng(req, url)) {
        res.writeHead(200, {
          "content-type": "image/png",
          "content-length": frame.data.length,
          "cache-control": "no-store",
          "x-frame-id": String(frame.frame_id),
          "x-frame-width": String(frame.width),
          "x-frame-height": String(frame.height),
          "x-captured-at": String(frame.captured_at),
          ...corsHeaders(),
        });
        res.end(frame.data);
        return;
      }
      return send(res, 200, {
        mime: "image/png",
        data: frame.data.toString("base64"),
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
        captured_at: frame.captured_at,
      });
    }

    // GET /snapshot — latest frame + age_ms
    if (method === "GET" && p === "/snapshot") {
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const frame = ctx.capture.getLatest();
      if (!frame) {
        return send(res, 404, { ok: false, error: "no frame yet" });
      }
      const age_ms = ctx.capture.getAgeMs() ?? 0;
      return send(res, 200, {
        mime: "image/png",
        data: frame.data.toString("base64"),
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
        captured_at: frame.captured_at,
        age_ms,
      });
    }

    // POST /snapshot — forceCapture
    if (method === "POST" && p === "/snapshot") {
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      try {
        const frame = await ctx.capture.forceCapture();
        const age_ms = ctx.capture.getAgeMs() ?? 0;
        return send(res, 200, {
          mime: "image/png",
          data: frame.data.toString("base64"),
          width: frame.width,
          height: frame.height,
          frame_id: frame.frame_id,
          captured_at: frame.captured_at,
          age_ms,
        });
      } catch (e) {
        return send(res, 502, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // GET /snapshot/config
    if (method === "GET" && p === "/snapshot/config") {
      const latest = ctx.capture.getLatest();
      return send(res, 200, {
        interval_ms: ctx.capture.getIntervalMs(),
        live_loop: ctx.capture.isRunning(),
        has_frame: !!latest,
        last_frame_id: latest?.frame_id ?? null,
        last_captured_at: latest?.captured_at ?? null,
      });
    }

    // PUT /snapshot/config
    if (method === "PUT" && p === "/snapshot/config") {
      const body = (await readJson(req)) as { interval_ms?: unknown };
      if (typeof body.interval_ms !== "number") {
        return send(res, 400, {
          ok: false,
          error: "interval_ms required (number)",
        });
      }
      try {
        ctx.capture.setIntervalMs(body.interval_ms);
      } catch (e) {
        return send(res, 400, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      const latest = ctx.capture.getLatest();
      return send(res, 200, {
        ok: true,
        interval_ms: ctx.capture.getIntervalMs(),
        live_loop: ctx.capture.isRunning(),
        has_frame: !!latest,
        last_frame_id: latest?.frame_id ?? null,
        last_captured_at: latest?.captured_at ?? null,
      });
    }

    if (method === "GET" && p === "/state") {
      const state = ctx.backend.isRomLoaded()
        ? await ctx.backend.getState()
        : null;
      return send(res, 200, { state });
    }

    if (method === "GET" && p === "/mode") {
      return send(res, 200, { ok: true, mode: ctx.mode.get() });
    }

    if (method === "POST" && p === "/mode") {
      const body = (await readJson(req)) as { mode?: ControlMode };
      if (!body.mode || !["agent", "nudge", "drive"].includes(body.mode)) {
        return send(res, 400, { ok: false, error: "invalid mode" });
      }
      ctx.mode.set(body.mode);
      return send(res, 200, { ok: true, mode: ctx.mode.get() });
    }

    if (method === "POST" && p === "/input") {
      if (ctx.mode.get() !== "agent") {
        return send(res, 409, {
          ok: false,
          error: `input blocked: mode is ${ctx.mode.get()}`,
          mode: ctx.mode.get(),
        });
      }
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const body = (await readJson(req)) as { buttons?: Button[] };
      const buttons = body.buttons || [];
      if (!Array.isArray(buttons) || buttons.length === 0) {
        return send(res, 400, { ok: false, error: "buttons required" });
      }
      if (buttons.length > 5) {
        return send(res, 400, {
          ok: false,
          error: "max 5 buttons per request",
        });
      }
      for (const b of buttons) {
        if (!VALID_BUTTONS.has(b)) {
          return send(res, 400, { ok: false, error: `invalid button: ${b}` });
        }
      }
      await ctx.backend.press(buttons);
      return send(res, 200, {
        ok: true,
        executed: buttons,
        mode: ctx.mode.get(),
      });
    }

    if (method === "POST" && p === "/run") {
      if (typeof ctx.startRun !== "function") {
        return send(res, 501, { ok: false, error: "run-start not available" });
      }
      const body = (await readJson(req)) as { rom_path?: string };
      if (!body.rom_path || typeof body.rom_path !== "string") {
        return send(res, 400, { ok: false, error: "rom_path required" });
      }
      try {
        const run = await ctx.startRun(body.rom_path);
        return send(res, 200, { ok: true, ...run });
      } catch (e) {
        return send(res, 502, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (method === "POST" && p === "/save") {
      const body = (await readJson(req)) as { name?: string };
      if (!body.name || !SAVE_NAME_RE.test(body.name)) {
        return send(res, 400, { ok: false, error: "invalid name" });
      }
      const file = await ctx.backend.saveState(body.name, ctx.getSaveDir());
      return send(res, 200, { ok: true, name: body.name, path: file });
    }

    if (method === "POST" && p === "/load") {
      const body = (await readJson(req)) as { name?: string };
      if (!body.name || !SAVE_NAME_RE.test(body.name)) {
        return send(res, 400, { ok: false, error: "invalid name" });
      }
      await ctx.backend.loadState(body.name, ctx.getSaveDir());
      return send(res, 200, { ok: true, name: body.name });
    }

    if (method === "GET" && p === "/saves") {
      const saves = await ctx.backend.listSaves(ctx.getSaveDir());
      return send(res, 200, { saves });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return send(res, 500, { ok: false, error: msg });
  }
}
