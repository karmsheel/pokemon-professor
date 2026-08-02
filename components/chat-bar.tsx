"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  isStartGameIntent,
  romNeededMessage,
  romReadyMessage,
} from "@/lib/chat-actions";

type Role = "user" | "assistant" | "system";
type ControlMode = "agent" | "nudge" | "drive";
type ChatTab = "ga" | "student";

type UiMessage = {
  id: string;
  role: Role;
  content: string;
};

export type ChatBarStudent = {
  id: string;
  name: string;
  avatar: "boy" | "girl";
};

export type ChatBarProps = {
  mode?: ControlMode;
  variant?: "sidebar" | "bar";
  /** Null until cutscene creates / user has a Student. */
  student: ChatBarStudent | null;
  students: ChatBarStudent[];
  /** True after cutscene complete (or resume) and Student is playing. */
  studentUnlocked: boolean;
  /** Emulator started (ROM running); may still be in cutscene. */
  emulatorRunning: boolean;
  cutsceneActive: boolean;
  romPath: string | null;
  runId: string | null;
  onRomLoaded: (path: string) => void;
  onRunStarted: (run: { id: string }, romPath: string) => void;
  /** Called when Start game should open Student cutscene (no student yet). */
  onRequestStudentCutscene: () => void;
  /** Called when Start game should resume an existing Student. */
  onResumeStudentPlay: (studentId: string) => void;
  onSwitchStudentRequest: () => void;
  toast: string | null;
  onDismissToast: () => void;
  /** Inject student history after cutscene. */
  studentHistorySeed?: UiMessage[] | null;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function romBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function modeSystemNote(mode: ControlMode): string {
  if (mode === "nudge") return "Agent tools frozen (nudge)";
  if (mode === "drive") return "Agent tools frozen (drive)";
  return "Agent tools resumed";
}

export function ChatBar({
  mode = "agent",
  variant = "sidebar",
  student,
  students,
  studentUnlocked,
  emulatorRunning,
  cutsceneActive,
  romPath,
  runId,
  onRomLoaded,
  onRunStarted,
  onRequestStudentCutscene,
  onResumeStudentPlay,
  onSwitchStudentRequest,
  toast,
  onDismissToast,
  studentHistorySeed,
}: ChatBarProps) {
  const [tab, setTab] = useState<ChatTab>("ga");
  const [gaMessages, setGaMessages] = useState<UiMessage[]>([]);
  const [studentMessages, setStudentMessages] = useState<UiMessage[]>([]);
  const [studentUnread, setStudentUnread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState("Game Assistant");
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevModeRef = useRef<ControlMode | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const messages = tab === "ga" ? gaMessages : studentMessages;
  const studentEnabled = studentUnlocked && Boolean(student) && !cutsceneActive;

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // Load global GA thread
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.studio?.getGaThread) {
        setGaMessages([
          {
            id: newId(),
            role: "assistant",
            content:
              "Welcome, Professor. Load your FireRed ROM, then Start game. A Student will contact you after the game boots.",
          },
        ]);
        return;
      }
      try {
        if (window.studio.ensureGa) {
          await window.studio.ensureGa();
        }
        const thread = await window.studio.getGaThread();
        if (cancelled) return;
        setGaMessages(
          thread.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
        );
      } catch {
        /* ignore */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed student history after cutscene
  useEffect(() => {
    if (studentHistorySeed && studentHistorySeed.length > 0) {
      setStudentMessages(studentHistorySeed);
      setTab("student");
      setStudentUnread(false);
      setStatusNote(student ? `${student.name} · playing` : "Student");
    }
  }, [studentHistorySeed, student]);

  // Load existing student session when student becomes available (resume)
  useEffect(() => {
    if (!student || cutsceneActive) return;
    let cancelled = false;
    const load = async () => {
      if (!window.studio?.getStudentPlaySession) return;
      try {
        const play = await window.studio.getStudentPlaySession(student.id);
        if (cancelled || !play?.session?.messages?.length) return;
        if (!studentHistorySeed) {
          setStudentMessages(
            play.session.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            }))
          );
        }
      } catch {
        /* ignore */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [student?.id, cutsceneActive, studentHistorySeed]);

  useEffect(() => {
    if (!romPath) return;
    setGaMessages((prev) => {
      const note = romReadyMessage(romBasename(romPath));
      if (prev.some((m) => m.content === note)) return prev;
      return [...prev, { id: newId(), role: "system", content: note }];
    });
  }, [romPath]);

  useEffect(() => {
    if (prevModeRef.current === null) {
      prevModeRef.current = mode;
      return;
    }
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    const note = {
      id: newId(),
      role: "system" as const,
      content: modeSystemNote(mode),
    };
    setGaMessages((prev) => [...prev, note]);
    if (studentEnabled) {
      setStudentMessages((prev) => [...prev, note]);
    }
  }, [mode, studentEnabled]);

  useEffect(() => {
    if (studentEnabled && student) {
      setStatusNote(`${student.name} · playing`);
    } else if (cutsceneActive) {
      setStatusNote("Student setup…");
      setTab("ga");
    } else {
      setStatusNote("Game Assistant");
      setTab("ga");
    }
  }, [studentEnabled, student, cutsceneActive]);

  const loadRom = useCallback(async () => {
    if (!window.studio?.pickRom || busy || sending || cutsceneActive) return;
    setBusy(true);
    setError(null);
    try {
      const path = await window.studio.pickRom();
      if (!path) return;
      if (window.studio.setLastRomPath) {
        await window.studio.setLastRomPath(path);
      }
      onRomLoaded(path);
      setGaMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "system",
          content: romReadyMessage(romBasename(path)),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load ROM failed");
    } finally {
      setBusy(false);
    }
  }, [busy, sending, cutsceneActive, onRomLoaded]);

  const startGame = useCallback(async () => {
    if (busy || sending || cutsceneActive) return;
    if (!window.studio?.startGame) {
      setError("Open the desktop app to start the game");
      return;
    }

    setBusy(true);
    setSending(true);
    setError(null);
    try {
      if (!romPath) {
        setGaMessages((prev) => [
          ...prev,
          { id: newId(), role: "system", content: romNeededMessage() },
        ]);
        setError("Load a FireRed ROM first");
        return;
      }

      const result = await window.studio.startGame(romPath);
      onRunStarted({ id: result.id }, result.rom_path);

      setGaMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "system",
          content: `Game started (${result.connect}). Connecting a Student…`,
        },
      ]);

      // First-time: cutscene. Returning: resume existing Student.
      if (!student) {
        onRequestStudentCutscene();
      } else {
        onResumeStudentPlay(student.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start game failed");
    } finally {
      setBusy(false);
      setSending(false);
    }
  }, [
    busy,
    sending,
    cutsceneActive,
    romPath,
    student,
    onRunStarted,
    onRequestStudentCutscene,
    onResumeStudentPlay,
  ]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending || busy || cutsceneActive) return;

      if (tab === "ga" && isStartGameIntent(trimmed)) {
        setDraft("");
        await startGame();
        return;
      }

      if (tab === "student" && !studentEnabled) {
        setError("Student chat unlocks after setup");
        return;
      }

      const userMsg: UiMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
      };
      setDraft("");
      setSending(true);
      setError(null);

      if (tab === "ga") {
        setGaMessages((prev) => [...prev, userMsg]);
        try {
          if (!window.studio?.sendGaMessage) {
            setGaMessages((prev) => [
              ...prev,
              {
                id: newId(),
                role: "assistant",
                content:
                  "Use Load ROM and Start game when ready. (Desktop ACP required for live replies.)",
              },
            ]);
            return;
          }
          const reply = await window.studio.sendGaMessage(trimmed);
          setGaMessages((prev) => [
            ...prev,
            {
              id: reply.id,
              role: reply.role,
              content: reply.content,
            },
          ]);
        } catch (e) {
          setError(e instanceof Error ? e.message : "GA send failed");
        } finally {
          setSending(false);
        }
        return;
      }

      if (!student) {
        setSending(false);
        return;
      }

      setStudentMessages((prev) => [...prev, userMsg]);
      try {
        if (!window.studio?.sendStudentMessage) {
          setError("Desktop ACP required for Student chat");
          return;
        }
        const reply = await window.studio.sendStudentMessage(
          student.id,
          trimmed
        );
        setStudentMessages((prev) => [
          ...prev,
          {
            id: reply.id,
            role: reply.role,
            content: reply.content,
          },
        ]);
        if (tabRef.current !== "student") setStudentUnread(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Student send failed");
      } finally {
        setSending(false);
      }
    },
    [
      tab,
      sending,
      busy,
      cutsceneActive,
      studentEnabled,
      student,
      startGame,
    ]
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const selectTab = (next: ChatTab) => {
    if (next === "student" && !studentEnabled) return;
    setTab(next);
    if (next === "student") setStudentUnread(false);
  };

  return (
    <aside
      className={`chat-bar panel ${variant === "sidebar" ? "chat-bar-sidebar" : "chat-bar-strip"}`}
      data-testid="chat-bar"
      aria-label="Chat"
    >
      {toast ? (
        <div className="chat-toast" role="status">
          <span>{toast}</span>
          <button type="button" className="ghost" onClick={onDismissToast}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="chat-agent-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ga"}
          className={`agent-tab ${tab === "ga" ? "active" : ""}`}
          onClick={() => selectTab("ga")}
          title="Game Assistant"
        >
          <span className="agent-avatar ga">GA</span>
          <span className="agent-tab-label">Assistant</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "student"}
          className={`agent-tab ${tab === "student" ? "active" : ""} ${
            !studentEnabled ? "disabled" : ""
          }`}
          disabled={!studentEnabled}
          onClick={() => selectTab("student")}
          title={
            studentEnabled && student
              ? student.name
              : "Student unlocks after Start game setup"
          }
        >
          <span
            className={`agent-avatar student ${student?.avatar || "boy"}`}
          >
            {student ? (student.avatar === "boy" ? "♂" : "♀") : "?"}
            {studentUnread ? <span className="unread-dot" /> : null}
          </span>
          <span className="agent-tab-label">
            {student?.name || "Student"}
          </span>
        </button>
        <button
          type="button"
          className="agent-switcher ghost"
          title="Students"
          disabled={emulatorRunning || cutsceneActive || studentUnlocked}
          onClick={onSwitchStudentRequest}
        >
          ▾
        </button>
      </div>

      <div className="chat-bar-header">
        <span className="status-pill ok">{statusNote}</span>
        {runId ? (
          <span className="muted small">run {runId.slice(0, 8)}…</span>
        ) : null}
      </div>

      {!cutsceneActive ? (
        <div className="chat-cta-row">
          <button
            type="button"
            disabled={busy || sending}
            onClick={() => void loadRom()}
          >
            Load FireRed ROM…
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || sending || !romPath || emulatorRunning}
            onClick={() => void startGame()}
          >
            Start game
          </button>
        </div>
      ) : null}

      <div className="chat-messages" ref={listRef}>
        {tab === "student" && !studentEnabled ? (
          <div className="chat-bubble chat-bubble-system">
            <div className="chat-bubble-body">
              Student chat unlocks after you start the game and finish setup.
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble chat-bubble-${m.role}`}>
            <div className="chat-bubble-role">{m.role}</div>
            <div className="chat-bubble-body">{m.content}</div>
          </div>
        ))}
        {sending ? (
          <div className="chat-bubble chat-bubble-system">
            <div className="chat-bubble-body muted">Thinking…</div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="error-text chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="chat-compose" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            cutsceneActive
              ? "Finish Student setup…"
              : tab === "ga"
                ? "Message Game Assistant…"
                : `Message ${student?.name || "Student"}…`
          }
          rows={2}
          disabled={
            sending ||
            busy ||
            cutsceneActive ||
            (tab === "student" && !studentEnabled)
          }
        />
        <button
          type="submit"
          className="primary"
          disabled={
            sending ||
            busy ||
            cutsceneActive ||
            !draft.trim() ||
            (tab === "student" && !studentEnabled)
          }
        >
          Send
        </button>
      </form>
    </aside>
  );
}
