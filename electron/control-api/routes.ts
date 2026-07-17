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
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
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

    if (method === "GET" && p === "/frame") {
      if (!ctx.backend.isRomLoaded()) {
        return send(res, 409, { ok: false, error: "rom not loaded" });
      }
      const frame = await ctx.backend.getFramePng();
      return send(res, 200, {
        mime: "image/png",
        data: frame.data.toString("base64"),
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
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
