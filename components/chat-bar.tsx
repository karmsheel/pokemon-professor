"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type Role = "user" | "assistant" | "system";
type ControlMode = "agent" | "nudge" | "drive";

type UiMessage = {
  id: string;
  role: Role;
  content: string;
};

type HermesHealth = {
  ok: boolean;
  error?: string;
  hint?: string;
};

type ChatBarProps = {
  mode?: ControlMode;
  /** sidebar = right column (tall); bar = legacy bottom strip */
  variant?: "sidebar" | "bar";
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function modeSystemNote(mode: ControlMode): string {
  if (mode === "nudge") return "Agent tools frozen (nudge)";
  if (mode === "drive") return "Agent tools frozen (drive)";
  return "Agent tools resumed";
}

function modeBadgeClass(mode: ControlMode): string {
  if (mode === "agent") return "status-pill ok";
  return "status-pill warn";
}

export function ChatBar({ mode = "agent", variant = "sidebar" }: ChatBarProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [statusNote, setStatusNote] = useState<string>("checking Hermes…");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevModeRef = useRef<ControlMode | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // System note when control mode changes (skip first paint).
  useEffect(() => {
    if (prevModeRef.current === null) {
      prevModeRef.current = mode;
      return;
    }
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: "system",
        content: modeSystemNote(mode),
      },
    ]);
  }, [mode]);

  // Poll Hermes via our proxy so CORS never blocks; never touches emulator UI.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/hermes/chat", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as HermesHealth;
        if (cancelled) return;
        if (res.ok && data.ok !== false) {
          setConnected(true);
          setStatusNote("Hermes connected");
        } else {
          setConnected(false);
          setStatusNote(data.hint || "Hermes unavailable — run `hermes gateway`");
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setStatusNote("Hermes unavailable — run `hermes gateway`");
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: UiMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
      };

      // History for Hermes: user + assistant only (system notes are UI-only).
      const history = [...messages, userMsg];
      const apiMessages = history
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages(history);
      setDraft("");
      setSending(true);
      setError(null);

      try {
        const res = await fetch("/api/hermes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          content?: string;
          error?: string;
          hint?: string;
          details?: string;
        };

        if (!res.ok) {
          if (res.status === 503 || data.error === "hermes_unavailable") {
            setConnected(false);
            setStatusNote(data.hint || "Run hermes gateway");
            setError(
              data.hint
                ? `Hermes unavailable — ${data.hint}`
                : "Hermes unavailable — run `hermes gateway`"
            );
            return;
          }
          if (data.error === "hermes_auth_failed") {
            setError(
              data.hint ||
                "Hermes auth failed — set HERMES_API_KEY to match API_SERVER_KEY"
            );
            return;
          }
          setError(
            data.error
              ? data.details
                ? `${data.error}: ${data.details}`
                : data.error
              : `Chat failed (${res.status})`
          );
          return;
        }

        const reply = (data.content || "").trim() || "(empty reply)";
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: reply },
        ]);
        setConnected(true);
        setStatusNote("Hermes connected");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chat request failed");
      } finally {
        setSending(false);
      }
    },
    [messages, sending]
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

  const bubbleClass = (role: Role) => {
    if (role === "user") return "chat-bubble chat-bubble-user";
    if (role === "system") return "chat-bubble chat-bubble-system";
    return "chat-bubble chat-bubble-assistant";
  };

  const roleLabel = (role: Role) => {
    if (role === "user") return "Professor";
    if (role === "system") return "System";
    return "Hermes";
  };

  const shellClass =
    variant === "sidebar" ? "panel chat-bar chat-bar-sidebar" : "chat-bar chat-bar-strip";

  return (
    <section className={shellClass} aria-label="Hermes chat">
      <div className="chat-bar-header">
        <h2 className="chat-title">Hermes chat</h2>
        <div className="chat-bar-badges">
          <span
            className={`status-pill ${connected ? "ok" : ""}`}
            title={statusNote}
          >
            <span className="dot" />
            {connected ? "online" : "offline"}
          </span>
          <span
            className={modeBadgeClass(mode)}
            data-testid="chat-mode-badge"
            title="Control mode"
          >
            <span className="dot" />
            {mode}
          </span>
        </div>
        <span className="muted chat-status-note">{statusNote}</span>
      </div>

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Coach your disciple here. Emulator and Drive keep working even when
            Hermes is offline.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={bubbleClass(m.role)}>
              <div className="chat-bubble-role">{roleLabel(m.role)}</div>
              <div className="chat-bubble-body">{m.content}</div>
            </div>
          ))
        )}
        {sending ? (
          <p className="muted" style={{ margin: 0 }}>
            Thinking…
          </p>
        ) : null}
      </div>

      {error ? <p className="error-text chat-error">{error}</p> : null}

      <form className="chat-compose" onSubmit={onSubmit}>
        <label htmlFor="hermes-chat" className="sr-only">
          Chat with Hermes
        </label>
        <textarea
          id="hermes-chat"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            connected
              ? "Message Hermes… (Enter to send, Shift+Enter for newline)"
              : "Hermes offline — you can still type; send will show unavailable"
          }
          rows={variant === "sidebar" ? 4 : 2}
          disabled={sending}
        />
        <button
          type="submit"
          className="primary"
          disabled={sending || !draft.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
