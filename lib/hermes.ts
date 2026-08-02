import { fillHermesAuthGaps } from "./hermes-env";
import {
  normalizeHermesSettings,
  type HermesSettings,
} from "./hermes-settings";

export type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | string;
  content: string;
};

/**
 * Defaults from process env + auto-detected Hermes API_SERVER_KEY.
 * Empty HERMES_API_KEY is filled from the local Hermes Agent .env when present.
 */
export function hermesConfig(): HermesConfig {
  const filled = fillHermesAuthGaps({
    baseUrl: process.env.HERMES_BASE_URL,
    apiKey: process.env.HERMES_API_KEY,
    model: process.env.HERMES_MODEL,
  });
  return {
    baseUrl: filled.baseUrl,
    apiKey: filled.apiKey,
    model: filled.model,
  };
}

/**
 * Merge optional per-request settings over env / Hermes-detected defaults.
 * Empty-string overrides do NOT wipe a real API key (fixes gate/settings
 * sending apiKey:"" and causing 401 against API_SERVER_KEY-protected gateways).
 */
export function resolveHermesConfig(
  override?: Partial<HermesSettings> | null
): HermesConfig {
  const filled = fillHermesAuthGaps({
    baseUrl: override?.baseUrl,
    apiKey: override?.apiKey,
    model: override?.model,
  });
  return normalizeHermesSettings({
    baseUrl: filled.baseUrl,
    apiKey: filled.apiKey,
    model: filled.model,
  });
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
