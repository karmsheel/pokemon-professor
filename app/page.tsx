"use client";

import { useEffect, useState } from "react";
import { ChatBar } from "@/components/chat-bar";
import { LiveView } from "@/components/live-view";
import { OverrideControls } from "@/components/override-controls";
import { RunRail } from "@/components/run-rail";
import { fetchHealth } from "@/lib/control-client";

type ControlMode = "agent" | "nudge" | "drive";

export default function StudioPage() {
  const [controlUrl, setControlUrl] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [romPath, setRomPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ControlMode>("agent");
  const [healthNote, setHealthNote] = useState<string>("connecting…");

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!controlUrl) return;
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
  }, [controlUrl]);

  return (
    <div className="studio-root">
      <div className="studio-main">
        <RunRail
          runId={runId}
          romPath={romPath}
          onRunStarted={(run, path) => {
            setRunId(run.id);
            setRomPath(path);
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: "0.5rem" }}>
          <div className="status-pill ok" style={{ alignSelf: "flex-start" }}>
            <span className="dot" />
            {healthNote}
          </div>
          <LiveView controlUrl={controlUrl} />
        </div>
        <OverrideControls mode={mode} onModeChange={setMode} />
      </div>
      <ChatBar />
    </div>
  );
}
