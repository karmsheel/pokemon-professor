// electron/control-api/types.ts

export const API_VERSION = "0.1.0";

export type ControlMode = "agent" | "nudge" | "drive";

export type Button =
  | "A"
  | "B"
  | "START"
  | "SELECT"
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "L"
  | "R";

export interface FireRedState {
  map_id?: number;
  map_name?: string;
  x?: number;
  y?: number;
  party?: Array<{
    species?: string;
    level?: number;
    hp?: number;
    max_hp?: number;
    status?: string;
  }>;
  in_battle?: boolean;
  badges?: number;
  money?: number;
}

export interface HealthResponse {
  ok: true;
  api_version: string;
  mode: ControlMode;
  emulator: "mock" | "mgba" | "none";
  rom_loaded: boolean;
  run_id: string | null;
}

export interface FrameResponse {
  mime: "image/png";
  /** base64-encoded PNG */
  data: string;
  width: number;
  height: number;
  frame_id: number;
}

export interface StateResponse {
  state: FireRedState | null;
}

export interface InputRequest {
  buttons: Button[];
}

export interface InputResponse {
  ok: true;
  executed: Button[];
  mode: ControlMode;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  mode?: ControlMode;
}

export interface ModeRequest {
  mode: ControlMode;
}

export interface ModeResponse {
  ok: true;
  mode: ControlMode;
}

export interface SaveRequest {
  name: string;
}

export interface SaveResponse {
  ok: true;
  name: string;
  path: string;
}

export interface LoadRequest {
  name: string;
}

export interface LoadResponse {
  ok: true;
  name: string;
}

export interface SavesResponse {
  saves: string[];
}

export type MissionSource = "template" | "freeform";
export type MissionStatus = "active" | "paused" | "done" | "aborted";
export type RunStatus = "active" | "paused" | "ended";

export interface Mission {
  id: string;
  prompt: string;
  source: MissionSource;
  status: MissionStatus;
  started_at: string;
  ended_at?: string;
}

export interface RunEvent {
  at: string;
  type: string;
  detail?: Record<string, unknown>;
}

export interface Run {
  id: string;
  rom_path: string;
  created_at: string;
  status: RunStatus;
  missions: Mission[];
  events: RunEvent[];
  savestates: string[];
}

export interface EmulatorBackend {
  readonly kind: "mock" | "mgba";
  start(romPath: string): Promise<void>;
  stop(): Promise<void>;
  isRomLoaded(): boolean;
  getFramePng(): Promise<{ data: Buffer; width: number; height: number; frame_id: number }>;
  getState(): Promise<FireRedState | null>;
  press(buttons: Button[]): Promise<void>;
  saveState(name: string, dir: string): Promise<string>;
  loadState(name: string, dir: string): Promise<void>;
  listSaves(dir: string): Promise<string[]>;
}
