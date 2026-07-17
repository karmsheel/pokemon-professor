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

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatBar() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [statusNote, setStatusNote] = useState<string>("checking Hermes…");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

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

      const history = [...messages, userMsg];
      setMessages(history);
      setDraft("");
      setSending(true);
      setError(null);

      try {
        const res = await fetch("/api/hermes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
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

  return (
    <footer className="chat-bar">
      <div className="chat-bar-header">
        <div className="row" style={{ gap: "0.65rem", flex: "0 0 auto" }}>
          <span
            className={`status-pill ${connected ? "ok" : ""}`}
            title={statusNote}
          >
            <span className="dot" />
            {connected ? "Hermes" : "Hermes offline"}
          </span>
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {statusNote}
          </span>
        </div>
      </div>

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Coach your disciple here. Emulator and Drive keep working even when
            Hermes is offline.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`chat-bubble chat-bubble-${m.role === "user" ? "user" : "assistant"}`}
            >
              <div className="chat-bubble-role">
                {m.role === "user" ? "Professor" : "Hermes"}
              </div>
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
          rows={2}
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
    </footer>
  );
}
