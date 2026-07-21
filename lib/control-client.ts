export async function fetchFrame(controlUrl: string) {
  const res = await fetch(`${controlUrl}/frame`);
  if (!res.ok) throw new Error(`frame ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
  }>;
}

/**
 * Live-view path: raw PNG body + metadata headers (no base64 JSON).
 * Prefer this for continuous streaming — cheaper to transfer and paint.
 */
export async function fetchFrameBlob(controlUrl: string): Promise<{
  blob: Blob;
  width: number;
  height: number;
  frame_id: number;
  captured_at: number | null;
}> {
  const res = await fetch(`${controlUrl}/frame?raw=1`, {
    headers: { Accept: "image/png" },
    cache: "no-store",
  });
  if (!res.ok) {
    // 500 body is JSON { ok:false, error } even on the raw path.
    let detail = `frame ${res.status}`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) detail = parsed.error;
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  if (blob.size < 8) {
    throw new Error("frame empty");
  }
  const width = Number(res.headers.get("x-frame-width") || 240);
  const height = Number(res.headers.get("x-frame-height") || 160);
  const frame_id = Number(res.headers.get("x-frame-id") || 0);
  const captured_at = res.headers.get("x-captured-at");
  return {
    blob,
    width,
    height,
    frame_id,
    captured_at: captured_at != null ? Number(captured_at) : null,
  };
}

export async function fetchSnapshot(controlUrl: string) {
  const res = await fetch(`${controlUrl}/snapshot`);
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
    captured_at: number;
    age_ms: number;
  }>;
}

export async function forceSnapshot(controlUrl: string) {
  const res = await fetch(`${controlUrl}/snapshot`, { method: "POST" });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json() as Promise<{
    mime: string;
    data: string;
    width: number;
    height: number;
    frame_id: number;
    captured_at: number;
    age_ms: number;
  }>;
}

export async function fetchHealth(controlUrl: string) {
  const res = await fetch(`${controlUrl}/health`);
  return res.json() as Promise<{
    ok: boolean;
    api_version?: string;
    mode?: string;
    emulator?: string;
    rom_loaded?: boolean;
    run_id?: string | null;
  }>;
}

export async function fetchSaves(controlUrl: string) {
  const res = await fetch(`${controlUrl}/saves`);
  if (!res.ok) throw new Error(`saves ${res.status}`);
  return res.json() as Promise<{ saves: string[] }>;
}
