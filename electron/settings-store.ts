import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_HERMES_SETTINGS,
  normalizeHermesSettings,
  type HermesSettings,
} from "../lib/hermes-settings";

export type StudioSettings = {
  hermes: HermesSettings;
  lastRomPath: string | null;
};

export function defaultStudioSettings(): StudioSettings {
  return { hermes: { ...DEFAULT_HERMES_SETTINGS }, lastRomPath: null };
}

function settingsPath(userData: string): string {
  return path.join(userData, "studio-settings.json");
}

export function loadStudioSettings(userData: string): StudioSettings {
  const p = settingsPath(userData);
  if (!fs.existsSync(p)) return defaultStudioSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<StudioSettings>;
    return {
      hermes: normalizeHermesSettings(raw.hermes),
      lastRomPath:
        typeof raw.lastRomPath === "string" && raw.lastRomPath.trim()
          ? raw.lastRomPath
          : null,
    };
  } catch {
    return defaultStudioSettings();
  }
}

export function saveStudioSettings(userData: string, settings: StudioSettings): void {
  fs.mkdirSync(userData, { recursive: true });
  const out: StudioSettings = {
    hermes: normalizeHermesSettings(settings.hermes),
    lastRomPath: settings.lastRomPath,
  };
  fs.writeFileSync(settingsPath(userData), JSON.stringify(out, null, 2), "utf8");
}
