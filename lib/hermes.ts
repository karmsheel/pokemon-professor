export type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | string;
  content: string;
};

export function hermesConfig(): HermesConfig {
  return {
    baseUrl: process.env.HERMES_BASE_URL || "http://127.0.0.1:8642",
    apiKey: process.env.HERMES_API_KEY || "",
    model: process.env.HERMES_MODEL || "hermes-agent",
  };
}

export function hermesBaseUrl(config: HermesConfig = hermesConfig()): string {
  return config.baseUrl.replace(/\/$/, "");
}

/** True when the local Hermes gateway is not reachable (down / refused / timed out). */
export function isHermesUnavailable(err: unknown): boolean {
  const codes = collectErrorCodes(err);
  if (
    codes.has("ECONNREFUSED") ||
    codes.has("ENOTFOUND") ||
    codes.has("ECONNRESET") ||
    codes.has("ETIMEDOUT") ||
    codes.has("UND_ERR_CONNECT_TIMEOUT") ||
    codes.has("UND_ERR_SOCKET")
  ) {
    return true;
  }

  if (err instanceof Error) {
    const name = err.name.toLowerCase();
    if (name === "aborterror" || name === "timeouterror") return true;
    const msg = err.message.toLowerCase();
    if (
      msg.includes("econnrefused") ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("socket hang up")
    ) {
      return true;
    }
  }

  return false;
}

function collectErrorCodes(err: unknown, into = new Set<string>()): Set<string> {
  if (!err || typeof err !== "object") return into;
  const rec = err as { code?: unknown; cause?: unknown };
  if (typeof rec.code === "string") into.add(rec.code);
  if (rec.cause) collectErrorCodes(rec.cause, into);
  return into;
}
