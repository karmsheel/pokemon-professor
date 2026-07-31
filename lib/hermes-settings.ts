export type HermesSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export const DEFAULT_HERMES_SETTINGS: HermesSettings = {
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "",
  model: "hermes-agent",
};

export const HERMES_DOCS_URL = "https://hermes-agent.nousresearch.com/";

export function normalizeHermesSettings(
  input: Partial<HermesSettings> | null | undefined
): HermesSettings {
  const baseUrl = (input?.baseUrl ?? DEFAULT_HERMES_SETTINGS.baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const apiKey = (input?.apiKey ?? DEFAULT_HERMES_SETTINGS.apiKey).trim();
  const modelRaw = (input?.model ?? DEFAULT_HERMES_SETTINGS.model).trim();
  const model = modelRaw || DEFAULT_HERMES_SETTINGS.model;
  return {
    baseUrl: baseUrl || DEFAULT_HERMES_SETTINGS.baseUrl,
    apiKey,
    model,
  };
}

export function isValidHermesBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
