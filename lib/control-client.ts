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
