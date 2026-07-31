"use client";

import { useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
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
              disabled={busy}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hermes-api-key">API key</label>
            <input
              id="hermes-api-key"
              type="password"
              autoComplete="off"
              placeholder="Optional"
              value={apiKey}
              disabled={busy}
              onChange={(e) => setApiKey(e.target.value)}
            />
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
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row hermes-gate-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void connect()}
          >
            {busy ? "Connecting…" : error ? "Retry" : "Connect"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void openDocs()}
          >
            Open Hermes docs
          </button>
        </div>
      </div>
    </div>
  );
}
