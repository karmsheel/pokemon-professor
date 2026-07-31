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
  gameStartedKickoffMessage,
  isStartGameIntent,
  romNeededMessage,
  romReadyMessage,
  welcomeMessage,
} from "@/lib/chat-actions";
import {
  HERMES_DOCS_URL,
  type HermesSettings,
} from "@/lib/hermes-settings";

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

export type ChatBarProps = {
  mode?: ControlMode;
  /** sidebar = right column (tall); bar = legacy bottom strip */
  variant?: "sidebar" | "bar";
  hermesSettings: HermesSettings;
  romPath: string | null;
  runId: string | null;
  onRomLoaded: (path: string) => void;
  onRunStarted: (run: { id: string }, romPath: string) => void;
  /** Optional: return to hard gate after failed reconnect */
  onHermesLost?: () => void;
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

function romBasename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function hermesQuery(settings: HermesSettings): string {
  const q = new URLSearchParams({
    baseUrl: settings.baseUrl,
    model: settings.model,
  });
  if (settings.apiKey) q.set("apiKey", settings.apiKey);
  return q.toString();
}

export function ChatBar({
  mode = "agent",
  variant = "sidebar",
  hermesSettings,
  romPath,
  runId,
  onRomLoaded,
  onRunStarted,
  onHermesLost,
}: ChatBarProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [statusNote, setStatusNote] = useState<string>("checking Hermes…");
  const [error, setError] = useState<string | null>(null);
  const [hasStudio, setHasStudio] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** True after Hermes has been online at least once this session (for reconnect strip). */
  const [everConnected, setEverConnected] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevModeRef = useRef<ControlMode | null>(null);
  const welcomedRef = useRef(false);
  const romPathRef = useRef(romPath);
  romPathRef.current = romPath;

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  useEffect(() => {
    setHasStudio(Boolean(typeof window !== "undefined" && window.studio));
  }, []);

  // Welcome + ROM status once on mount.
  useEffect(() => {
    if (welcomedRef.current) return;
    welcomedRef.current = true;
    const path = romPathRef.current;
    setMessages([
      { id: newId(), role: "system", content: welcomeMessage() },
      {
        id: newId(),
        role: "system",
        content: path
          ? romReadyMessage(romBasename(path))
          : romNeededMessage(),
      },
    ]);
  }, []);

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
        const res = await fetch(`/api/hermes/chat?${hermesQuery(hermesSettings)}`, {
          method: "GET",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as HermesHealth;
        if (cancelled) return;
        if (res.ok && data.ok !== false) {
          setEverConnected(true);
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
  }, [hermesSettings.baseUrl, hermesSettings.apiKey, hermesSettings.model]);

  const pushSystem = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "system", content },
    ]);
  }, []);

  const loadRom = useCallback(async () => {
    if (!window.studio?.pickRom || busy || sending) return;
    setBusy(true);
    setError(null);
    try {
      const path = await window.studio.pickRom();
      if (!path) return;
      if (window.studio.setLastRomPath) {
        await window.studio.setLastRomPath(path);
      }
      onRomLoaded(path);
      pushSystem(romReadyMessage(romBasename(path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load ROM failed");
    } finally {
      setBusy(false);
    }
  }, [busy, sending, onRomLoaded, pushSystem]);

  const startGame = useCallback(async () => {
    if (busy || sending) return;
    if (!window.studio) {
      setError("Open the desktop app to start the game");
      return;
    }
    const path = romPath;
    if (!path) {
      setError("No ROM selected. Use Load FireRed ROM… first.");
      return;
    }

    setBusy(true);
    setSending(true);
    setError(null);
    try {
      // Prefer studio.startGame when Task 7 lands; interim = createRun + agent mode.
      const studioAny = window.studio as Window["studio"] & {
        startGame?: (romPath?: string | null) => Promise<{
          id: string;
          rom_path: string;
          connect?: "attach" | "spawn" | "mock";
          mode?: "agent";
        }>;
      };

      let runIdResult: string;
      let romResult: string;
      let connect: string | undefined;

      if (typeof studioAny?.startGame === "function") {
        const result = await studioAny.startGame(path);
        runIdResult = result.id;
        romResult = result.rom_path;
        connect = result.connect;
      } else {
        const run = await window.studio.createRun(path);
        runIdResult = run.id;
        romResult = path;
        connect = run.connect;
        if (window.studio.setMode) {
          await window.studio.setMode("agent");
        }
        if (window.studio.setLastRomPath) {
          await window.studio.setLastRomPath(path);
        }
      }

      onRunStarted({ id: runIdResult }, romResult);
      const how = connect ?? "emulator";
      pushSystem(
        `Run ${runIdResult.slice(0, 8)}… · ${how} · mode agent`
      );
      pushSystem(gameStartedKickoffMessage());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start game failed");
    } finally {
      setBusy(false);
      setSending(false);
    }
  }, [busy, sending, romPath, onRunStarted, pushSystem]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending || busy) return;

      // Start-game phrases never go to Hermes as chat — route to start handler.
      if (isStartGameIntent(trimmed)) {
        setDraft("");
        await startGame();
        return;
      }

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
            model: hermesSettings.model,
            hermes: hermesSettings,
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
        setEverConnected(true);
        setConnected(true);
        setStatusNote("Hermes connected");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chat request failed");
      } finally {
        setSending(false);
      }
    },
    [messages, sending, busy, hermesSettings, startGame]
  );

  const retryProbe = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      let ok = false;
      let hint = "Cannot reach Hermes — start the gateway, then Retry";

      if (window.studio?.probeHermes) {
        const r = await window.studio.probeHermes(hermesSettings);
        ok = r.ok;
        if (!ok) hint = r.hint || hint;
      } else {
        const res = await fetch(`/api/hermes/chat?${hermesQuery(hermesSettings)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as HermesHealth;
        ok = res.ok && data.ok !== false;
        if (!ok) hint = data.hint || hint;
      }

      if (ok) {
        setEverConnected(true);
        setConnected(true);
        setStatusNote("Hermes connected");
      } else {
        setConnected(false);
        setStatusNote(hint);
        setError(hint);
        // Prefer reconnect strip; only hard-gate if parent opts in.
        onHermesLost?.();
      }
    } catch {
      setConnected(false);
      const hint = "Cannot reach Hermes — start the gateway, then Retry";
      setStatusNote(hint);
      setError(hint);
      onHermesLost?.();
    } finally {
      setRetrying(false);
    }
  }, [hermesSettings, onHermesLost]);

  const openDocs = useCallback(async () => {
    if (window.studio?.openHermesDocs) await window.studio.openHermesDocs();
    else window.open(HERMES_DOCS_URL, "_blank", "noopener,noreferrer");
  }, []);

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

  const showReconnect = !connected && everConnected;
  const actionsLocked = busy || sending;
  const canStart = hasStudio && Boolean(romPath) && !actionsLocked;
  const canLoadRom = hasStudio && !actionsLocked;

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
          {runId ? (
            <span className="status-pill" title={runId}>
              run {runId.slice(0, 8)}…
            </span>
          ) : null}
        </div>
        <span className="muted chat-status-note">{statusNote}</span>
      </div>

      {showReconnect ? (
        <div className="reconnect-strip" data-testid="hermes-reconnect-strip">
          <span>Hermes disconnected</span>
          <div className="reconnect-strip-actions">
            <button
              type="button"
              className="primary"
              disabled={retrying}
              onClick={() => void retryProbe()}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
            <button type="button" disabled={retrying} onClick={() => void openDocs()}>
              Open Hermes docs
            </button>
          </div>
        </div>
      ) : null}

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Coach your disciple here.
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

      <div className="chat-cta-row" data-testid="chat-cta-row">
        <button
          type="button"
          disabled={!canLoadRom}
          onClick={() => void loadRom()}
          title={
            hasStudio
              ? "Pick your legally obtained FireRed .gba ROM"
              : "Open the desktop app to load ROMs"
          }
        >
          Load FireRed ROM…
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canStart}
          onClick={() => void startGame()}
          title={
            !hasStudio
              ? "Open the desktop app to start the game"
              : !romPath
                ? "Load a FireRed ROM first"
                : "Start run in agent mode"
          }
        >
          Start game
        </button>
      </div>
      {!hasStudio ? (
        <p className="muted chat-desktop-hint">
          Open the desktop app to load ROMs and start the game.
        </p>
      ) : null}

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
          disabled={sending || busy}
        />
        <button
          type="submit"
          className="primary"
          disabled={sending || busy || !draft.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
