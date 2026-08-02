"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatBar } from "@/components/chat-bar";
import { HermesAcpGate } from "@/components/hermes-acp-gate";
import { LiveView } from "@/components/live-view";
import { MeetGa } from "@/components/meet-ga";
import { OverrideControls } from "@/components/override-controls";
import { RunRail } from "@/components/run-rail";
import { StudentCutscene } from "@/components/student-cutscene";
import { StudentSelect } from "@/components/student-select";
import { fetchHealth } from "@/lib/control-client";

type ControlMode = "agent" | "nudge" | "drive";

type Student = {
  id: string;
  name: string;
  avatar: "boy" | "girl";
  backstory: string;
};

type Phase = "bootstrap" | "gate" | "meet-ga" | "studio";

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export default function StudioPage() {
  const [phase, setPhase] = useState<Phase>("bootstrap");
  const [students, setStudents] = useState<Student[]>([]);
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [cutsceneActive, setCutsceneActive] = useState(false);
  const [emulatorRunning, setEmulatorRunning] = useState(false);
  const [studentUnlocked, setStudentUnlocked] = useState(false);
  const [studentHistorySeed, setStudentHistorySeed] = useState<
    UiMessage[] | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);

  const [controlUrl, setControlUrl] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [romPath, setRomPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ControlMode>("agent");
  const [healthNote, setHealthNote] = useState<string>("connecting…");
  const [healthTone, setHealthTone] = useState<"ok" | "warn" | "danger">(
    "warn"
  );

  const refreshStudents = useCallback(async () => {
    if (!window.studio?.listStudents) {
      return {
        students: [] as Student[],
        activeStudentId: null as string | null,
        metGa: false,
      };
    }
    const data = await window.studio.listStudents();
    setStudents(data.students);
    const active =
      data.students.find((s) => s.id === data.activeStudentId) ||
      data.students[0] ||
      null;
    setActiveStudent(active);
    return data;
  }, []);

  // Bootstrap → gate / meet GA / main studio (no Student required).
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      let lastRom: string | null = null;
      if (window.studio?.getSettings) {
        try {
          const stored = await window.studio.getSettings();
          if (stored?.lastRomPath) lastRom = stored.lastRomPath;
        } catch {
          /* defaults */
        }
      }
      if (!cancelled && lastRom) setRomPath(lastRom);

      let metGa = false;

      if (window.studio?.listStudents) {
        try {
          const data = await window.studio.listStudents();
          if (cancelled) return;
          setStudents(data.students);
          metGa = data.metGa;
          const active =
            data.students.find((s) => s.id === data.activeStudentId) ||
            data.students[0] ||
            null;
          setActiveStudent(active);
        } catch {
          /* stay on gate path */
        }
      }

      let acpOk = false;
      if (window.studio?.probeHermesAcp || window.studio?.probeHermes) {
        try {
          const r = window.studio.probeHermesAcp
            ? await window.studio.probeHermesAcp()
            : await window.studio.probeHermes!();
          acpOk = Boolean(r.ok);
        } catch {
          acpOk = false;
        }
      } else {
        // Browser-only UI work
        acpOk = true;
        metGa = true;
      }

      if (cancelled) return;

      if (!acpOk) {
        setPhase("gate");
        return;
      }
      if (!metGa) {
        setPhase("meet-ga");
        return;
      }
      setPhase("studio");
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "studio") return;
    let cancelled = false;

    const boot = async () => {
      if (!window.studio) {
        setControlUrl("http://127.0.0.1:7946");
        setHealthNote("browser mode");
        return;
      }
      try {
        const url = await window.studio.getControlUrl();
        if (!cancelled) {
          setControlUrl(url);
          setHealthNote(url);
        }
        // Warm GA (seed welcome + optional ACP)
        await window.studio.ensureGa?.();
      } catch (e) {
        if (!cancelled) {
          setHealthNote(
            e instanceof Error ? e.message : "getControlUrl failed"
          );
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "studio" || !controlUrl) return;
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
        if (h.rom_loaded) {
          setEmulatorRunning(true);
          const emu =
            h.emulator === "mgba"
              ? "mGBA"
              : h.emulator === "mock"
                ? "Mock"
                : h.emulator ?? "emulator";
          setHealthNote(`${emu} · ROM loaded`);
          setHealthTone("ok");
        } else {
          setHealthNote("No ROM loaded");
          setHealthTone("warn");
        }
      } catch {
        if (!cancelled) {
          setHealthNote("health unreachable");
          setHealthTone("danger");
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, controlUrl]);

  useEffect(() => {
    if (!window.studio?.onFirstSavePromoted) return;
    return window.studio.onFirstSavePromoted(() => {
      setToast("First in-game save recorded — journey progress is now durable.");
    });
  }, []);

  useEffect(() => {
    if (phase !== "studio" || !window.studio?.consumeProvisionalDiscardToast)
      return;
    void window.studio.consumeProvisionalDiscardToast().then((t) => {
      if (t?.message) setToast(t.message);
    });
  }, [phase]);

  const resumeStudentPlay = useCallback(async (studentId: string) => {
    if (!window.studio?.startStudentPlay) {
      setStudentUnlocked(true);
      return;
    }
    try {
      const play = await window.studio.startStudentPlay(studentId);
      setActiveStudent(play.student);
      setStudentHistorySeed(
        play.session.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
      );
      setStudentUnlocked(true);
      setCutsceneActive(false);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to start Student");
    }
  }, []);

  if (phase === "bootstrap") {
    return (
      <div className="hermes-gate" data-testid="studio-bootstrap">
        <div className="hermes-gate-card panel">
          <p className="muted">Starting Studio…</p>
        </div>
      </div>
    );
  }

  if (phase === "gate") {
    return (
      <HermesAcpGate
        onReady={() => {
          setPhase("meet-ga");
        }}
      />
    );
  }

  if (phase === "meet-ga") {
    return (
      <MeetGa
        onContinue={() => {
          void window.studio?.setMetGa?.(true);
          setPhase("studio");
        }}
      />
    );
  }

  // Optional student picker (between journeys — not first-run gate)
  if (showStudentPicker) {
    return (
      <StudentSelect
        students={students}
        onCreated={async (s) => {
          setStudents((prev) =>
            prev.some((p) => p.id === s.id) ? prev : [...prev, s]
          );
          setActiveStudent(s);
          if (window.studio?.setActiveStudent) {
            await window.studio.setActiveStudent(s.id);
          }
          setShowStudentPicker(false);
        }}
        onSelect={async (id) => {
          if (window.studio?.setActiveStudent) {
            await window.studio.setActiveStudent(id);
          }
          await refreshStudents();
          setShowStudentPicker(false);
        }}
      />
    );
  }

  return (
    <div
      className={`studio-root ${cutsceneActive ? "studio-cutscene-mode" : ""}`}
    >
      <div className="studio-main">
        {!cutsceneActive ? (
          <aside className="studio-run-rail" aria-label="Run rail">
            <RunRail
              runId={runId}
              romPath={romPath}
              controlUrl={controlUrl}
              onRunStarted={(run, path) => {
                setRunId(run.id);
                setRomPath(path);
              }}
            />
          </aside>
        ) : null}

        <div
          className={`studio-center ${cutsceneActive ? "cutscene-pip" : ""}`}
        >
          <LiveView
            controlUrl={controlUrl}
            mode={mode}
            healthNote={healthNote}
            healthTone={healthTone}
          />
          {!cutsceneActive ? (
            <OverrideControls mode={mode} onModeChange={setMode} />
          ) : null}
        </div>

        {cutsceneActive ? (
          <div className="studio-cutscene-slot">
            <StudentCutscene
              onComplete={(result) => {
                setActiveStudent(result.student);
                setStudents((prev) => {
                  if (prev.some((p) => p.id === result.student.id)) return prev;
                  return [...prev, result.student];
                });
                setStudentHistorySeed(result.sessionMessages);
                setStudentUnlocked(true);
                setCutsceneActive(false);
                setToast(
                  `${result.student.name} is in the field. Watch them play — or coach in chat.`
                );
              }}
              onError={(msg) => setToast(msg)}
            />
          </div>
        ) : (
          <ChatBar
            mode={mode}
            variant="sidebar"
            student={activeStudent}
            students={students}
            studentUnlocked={studentUnlocked}
            emulatorRunning={emulatorRunning}
            cutsceneActive={false}
            romPath={romPath}
            runId={runId}
            toast={toast}
            onDismissToast={() => setToast(null)}
            studentHistorySeed={studentHistorySeed}
            onRomLoaded={(path) => setRomPath(path)}
            onRunStarted={(run, path) => {
              setRunId(run.id);
              setRomPath(path);
              setEmulatorRunning(true);
            }}
            onRequestStudentCutscene={() => {
              setCutsceneActive(true);
            }}
            onResumeStudentPlay={(id) => {
              void resumeStudentPlay(id);
            }}
            onSwitchStudentRequest={() => {
              if (emulatorRunning || studentUnlocked) {
                setToast(
                  "Finish or stop the current game before switching Student."
                );
                return;
              }
              setShowStudentPicker(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
