"use client";

import { useEffect, useState } from "react";
import {
  HERMES_DOCS_URL,
  isValidHermesBaseUrl,
  normalizeHermesSettings,
  type HermesSettings,
} from "@/lib/hermes-settings";

export type HermesConnectGateProps = {
  initial: HermesSettings;
  onConnected: (settings: HermesSettings) => void;
};

export function HermesConnectGate({
  initial,
  onConnected,
}: HermesConnectGateProps) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [keyHint, setKeyHint] = useState<string | null>(null);

  const locked = busy || restarting;
  const canRestartGateway = Boolean(window.studio?.restartHermesGateway);

  // Auto-detect API_SERVER_KEY from the local Hermes Agent install.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!window.studio?.detectHermesEnv) return;
      try {
        const info = await window.studio.detectHermesEnv();
        if (cancelled) return;
        if (info.filled.apiKey) {
          setApiKey((prev) => prev || info.filled.apiKey);
          if (info.filled.baseUrl) {
            setBaseUrl((prev) =>
              !prev || prev === "http://127.0.0.1:8642"
                ? info.filled.baseUrl
                : prev
            );
          }
          if (info.apiKeySource === "hermes-env") {
            setKeyHint(
              "API key loaded from Hermes API_SERVER_KEY (local .env) — no paste needed."
            );
          } else if (info.apiKeySource === "env") {
            setKeyHint("API key loaded from HERMES_API_KEY.");
          } else if (info.apiKeyConfigured) {
            setKeyHint("API key ready.");
          }
        } else {
          setKeyHint(
            "No API_SERVER_KEY found in Hermes .env — leave blank only if your gateway allows unauthenticated access."
          );
        }
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setStatusNote(null);
    const settings = normalizeHermesSettings({ baseUrl, apiKey, model });
    if (!isValidHermesBaseUrl(settings.baseUrl)) {
      setError("Enter a valid http(s) URL for the Hermes gateway.");
      setBusy(false);
      return;
    }
    try {
      let ok = false;
      let hint = "Cannot reach Hermes — start the gateway, then Retry";
      if (window.studio?.probeHermes) {
        const r = await window.studio.probeHermes(settings);
        ok = r.ok;
        if (!ok) hint = r.hint || hint;
        if (ok && window.studio.setHermesSettings) {
          await window.studio.setHermesSettings(settings);
        }
      } else {
        const q = new URLSearchParams({ baseUrl: settings.baseUrl });
        if (settings.apiKey) q.set("apiKey", settings.apiKey);
        if (settings.model) q.set("model", settings.model);
        const res = await fetch(`/api/hermes/chat?${q}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          hint?: string;
        };
        ok = res.ok && data.ok !== false;
        if (!ok) hint = data.hint || hint;
      }
      if (!ok) {
        setError(hint);
        return;
      }
      onConnected(settings);
    } catch {
      setError("Cannot reach Hermes — start the gateway, then Retry");
    } finally {
      setBusy(false);
    }
  };

  const restartGateway = async () => {
    if (!window.studio?.restartHermesGateway) {
      setError("Restart gateway requires the desktop app.");
      return;
    }
    setRestarting(true);
    setError(null);
    setStatusNote("Restarting Hermes gateway…");
    const settings = normalizeHermesSettings({ baseUrl, apiKey, model });
    if (!isValidHermesBaseUrl(settings.baseUrl)) {
      setError("Enter a valid http(s) URL for the Hermes gateway.");
      setRestarting(false);
      return;
    }
    try {
      const result = await window.studio.restartHermesGateway(settings);
      if (!result.ok) {
        setError(result.message);
        setStatusNote(null);
        return;
      }
      // Health already checked by the restart helper; persist + enter shell.
      if (window.studio.setHermesSettings) {
        await window.studio.setHermesSettings(settings);
      }
      setStatusNote(result.message);
      onConnected(settings);
      // Parent unmounts this gate — do not rely on further state updates.
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to restart Hermes gateway"
      );
      setStatusNote(null);
    } finally {
      setRestarting(false);
    }
  };

  const openDocs = async () => {
    if (window.studio?.openHermesDocs) await window.studio.openHermesDocs();
    else window.open(HERMES_DOCS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="hermes-gate" data-testid="hermes-connect-gate">
      <div className="hermes-gate-card panel">
        <h1>Connect Hermes</h1>
        <p className="muted">
          Pokemon Professor is agent-driven. Connect your local Hermes gateway to
          continue.
        </p>

        <div className="stack hermes-gate-fields">
          <div className="field">
            <label htmlFor="hermes-base-url">Base URL</label>
            <input
              id="hermes-base-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="http://127.0.0.1:8642"
              value={baseUrl}
              disabled={locked}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hermes-api-key">API key</label>
            <input
              id="hermes-api-key"
              type="password"
              autoComplete="off"
              placeholder="Auto from Hermes API_SERVER_KEY"
              value={apiKey}
              disabled={locked}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keyHint ? (
              <p className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>
                {keyHint}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="hermes-model">Model</label>
            <input
              id="hermes-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="hermes-agent"
              value={model}
              disabled={locked}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        {statusNote && !error ? (
          <p className="muted" data-testid="hermes-gate-status">
            {statusNote}
          </p>
        ) : null}

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row hermes-gate-actions">
          <button
            type="button"
            className="primary"
            disabled={locked}
            onClick={() => void connect()}
          >
            {busy ? "Connecting…" : error ? "Retry" : "Connect"}
          </button>
          <button
            type="button"
            disabled={locked || !canRestartGateway}
            title={
              canRestartGateway
                ? "Run hermes gateway restart, then connect when healthy"
                : "Restart gateway requires the desktop app"
            }
            onClick={() => void restartGateway()}
            data-testid="hermes-restart-gateway"
          >
            {restarting ? "Restarting…" : "Restart gateway"}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => void openDocs()}
          >
            Open Hermes docs
          </button>
        </div>
      </div>
    </div>
  );
}
