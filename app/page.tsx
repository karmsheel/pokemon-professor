"use client";

import { useEffect, useState } from "react";
import { ChatBar } from "@/components/chat-bar";
import { HermesConnectGate } from "@/components/hermes-connect-gate";
import { LiveView } from "@/components/live-view";
import { OverrideControls } from "@/components/override-controls";
import { RunRail } from "@/components/run-rail";
import { fetchHealth } from "@/lib/control-client";
import {
  DEFAULT_HERMES_SETTINGS,
  type HermesSettings,
} from "@/lib/hermes-settings";

type ControlMode = "agent" | "nudge" | "drive";

export default function StudioPage() {
  const [hermesReady, setHermesReady] = useState(false);
  const [hermesSettings, setHermesSettings] = useState<HermesSettings>(
    DEFAULT_HERMES_SETTINGS
  );
  /** False until mount bootstrap finishes (settings load + optional probe). */
  const [hermesBootstrapped, setHermesBootstrapped] = useState(false);

  const [controlUrl, setControlUrl] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [romPath, setRomPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ControlMode>("agent");
  const [healthNote, setHealthNote] = useState<string>("connecting…");

  // Load stored Hermes settings + last ROM + optional auto-probe. Fail → stay on gate.
  useEffect(() => {
    let cancelled = false;

    const bootHermes = async () => {
      let settings: HermesSettings = DEFAULT_HERMES_SETTINGS;
      let lastRom: string | null = null;

      if (window.studio?.getSettings) {
        try {
          const stored = await window.studio.getSettings();
          if (stored?.hermes) {
            settings = {
              baseUrl: stored.hermes.baseUrl,
              apiKey: stored.hermes.apiKey,
              model: stored.hermes.model,
            };
          }
          if (stored?.lastRomPath) {
            lastRom = stored.lastRomPath;
          }
        } catch {
          /* keep defaults */
        }
      }

      if (cancelled) return;
      setHermesSettings(settings);
      if (lastRom) setRomPath(lastRom);

      // Auto-probe once when studio IPC is available; never auto-enter on failure.
      if (window.studio?.probeHermes) {
        try {
          const r = await window.studio.probeHermes(settings);
          if (!cancelled && r.ok) {
            setHermesReady(true);
          }
        } catch {
          /* stay on gate */
        }
      }

      if (!cancelled) setHermesBootstrapped(true);
    };

    void bootHermes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hermesReady) return;
    let cancelled = false;

    const boot = async () => {
      if (!window.studio) {
        // Browser-only: allow pointing at a running Control API for UI work.
        const fallback = "http://127.0.0.1:7946";
        setControlUrl(fallback);
        setHealthNote("browser mode → " + fallback);
        return;
      }
      try {
        const url = await window.studio.getControlUrl();
        if (!cancelled) {
          setControlUrl(url);
          setHealthNote(url);
        }
      } catch (e) {
        if (!cancelled) {
          setHealthNote(e instanceof Error ? e.message : "getControlUrl failed");
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [hermesReady]);

  useEffect(() => {
    if (!hermesReady || !controlUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const h = await fetchHealth(controlUrl);
        if (cancelled) return;
        if (h.mode === "agent" || h.mode === "nudge" || h.mode === "drive") {
          setMode(h.mode);
        }
        if (h.run_id) setRunId(h.run_id);
        setHealthNote(
          `${h.emulator ?? "?"} · rom=${h.rom_loaded ? "yes" : "no"} · mode=${h.mode}`
        );
      } catch {
        if (!cancelled) setHealthNote("health unreachable");
      } finally {
        if (!cancelled) timer = setTimeout(tick, 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hermesReady, controlUrl]);

  // Match SSR + first client paint: hold until bootstrap so gate gets stored settings.
  if (!hermesBootstrapped) {
    return (
      <div className="hermes-gate" data-testid="hermes-bootstrap">
        <div className="hermes-gate-card panel">
          <p className="muted">Loading Hermes settings…</p>
        </div>
      </div>
    );
  }

  if (!hermesReady) {
    return (
      <HermesConnectGate
        key={`${hermesSettings.baseUrl}|${hermesSettings.model}`}
        initial={hermesSettings}
        onConnected={(s) => {
          setHermesSettings(s);
          setHermesReady(true);
        }}
      />
    );
  }

  return (
    <div className="studio-root">
      <div className="studio-main">
        <div className="studio-stage">
          <div className="studio-center">
            <div className="status-pill ok" style={{ alignSelf: "flex-start" }}>
              <span className="dot" />
              {healthNote}
            </div>
            <LiveView controlUrl={controlUrl} mode={mode} />
          </div>
          <div className="studio-run-rail">
            <RunRail
              runId={runId}
              romPath={romPath}
              controlUrl={controlUrl}
              onRunStarted={(run, path) => {
                setRunId(run.id);
                setRomPath(path);
              }}
            />
          </div>
        </div>
        <ChatBar
          mode={mode}
          variant="sidebar"
          hermesSettings={hermesSettings}
          romPath={romPath}
          runId={runId}
          onRomLoaded={(path) => setRomPath(path)}
          onRunStarted={(run, path) => {
            setRunId(run.id);
            setRomPath(path);
          }}
        />
      </div>
      <footer className="studio-footer">
        <OverrideControls mode={mode} onModeChange={setMode} />
      </footer>
    </div>
  );
}
