import { NextResponse } from "next/server";
import {
  hermesBaseUrl,
  isHermesUnavailable,
  resolveHermesConfig,
  type ChatMessage,
} from "@/lib/hermes";
import type { HermesSettings } from "@/lib/hermes-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  messages?: ChatMessage[];
  model?: string;
  system?: string;
  stream?: boolean;
  temperature?: number;
  hermes?: Partial<HermesSettings>;
};

function unavailableResponse() {
  return NextResponse.json(
    { error: "hermes_unavailable", hint: "Run hermes gateway" },
    { status: 503 }
  );
}

function authHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/** Health probe for the chat-bar connection badge. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const override = {
    baseUrl: url.searchParams.get("baseUrl") ?? undefined,
    apiKey: url.searchParams.get("apiKey") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
  };
  const config = resolveHermesConfig(override);
  const base = hermesBaseUrl(config);

  try {
    const res = await fetch(`${base}/health`, {
      method: "GET",
      headers: authHeaders(config.apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "hermes_unavailable",
          hint: "Run hermes gateway",
          status: res.status,
        },
        { status: 503 }
      );
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return NextResponse.json({
      ok: true,
      baseUrl: base,
      health: body,
    });
  } catch (err) {
    if (isHermesUnavailable(err)) {
      return unavailableResponse();
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "health probe failed",
      },
      { status: 500 }
    );
  }
}

/** OpenAI-compatible chat relay → Hermes gateway. */
export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "messages_required", hint: "POST { messages: [...] }" },
      { status: 400 }
    );
  }

  const config = resolveHermesConfig(body.hermes);
  const base = hermesBaseUrl(config);
  const url = `${base}/v1/chat/completions`;

  const openaiMessages: ChatMessage[] = [];
  if (body.system?.trim()) {
    openaiMessages.push({ role: "system", content: body.system.trim() });
  }
  for (const m of body.messages) {
    if (!m || typeof m.content !== "string") continue;
    openaiMessages.push({
      role: typeof m.role === "string" ? m.role : "user",
      content: m.content,
    });
  }

  if (openaiMessages.length === 0) {
    return NextResponse.json(
      { error: "messages_required", hint: "POST { messages: [...] }" },
      { status: 400 }
    );
  }

  // Alpha: non-streaming JSON relay (stream:true can land later without breaking clients).
  const wantStream = body.stream === true;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: authHeaders(config.apiKey),
      body: JSON.stringify({
        model: body.model?.trim() || config.model,
        messages: openaiMessages,
        stream: wantStream,
        temperature: body.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok) {
      const details = await upstream.text();
      if (upstream.status === 401 || upstream.status === 403) {
        return NextResponse.json(
          {
            error: "hermes_auth_failed",
            hint:
              "Hermes auth failed — studio auto-reads API_SERVER_KEY from your Hermes .env; restart the desktop app or reconnect so the key is applied",
            details,
          },
          { status: 502 }
        );
      }
      return NextResponse.json(
        {
          error: `Hermes error: ${upstream.status}`,
          details,
        },
        { status: 502 }
      );
    }

    if (wantStream && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type":
            upstream.headers.get("Content-Type") || "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
      model?: string;
    };
    const content =
      data.choices?.[0]?.message?.content?.trim() ||
      "No response from Hermes.";

    return NextResponse.json({
      content,
      model: data.model,
      usage: data.usage,
    });
  } catch (err) {
    if (isHermesUnavailable(err)) {
      return unavailableResponse();
    }
    console.error("Hermes chat proxy error", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Proxy failed",
      },
      { status: 500 }
    );
  }
}
