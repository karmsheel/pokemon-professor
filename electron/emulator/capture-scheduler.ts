import type { EmulatorBackend } from "./backend";

export type CapturedFrame = {
  data: Buffer;
  width: number;
  height: number;
  frame_id: number;
  captured_at: number;
};

const MIN_INTERVAL = 50;
const MAX_INTERVAL = 10000;
/** Yield between live captures so the event loop can serve HTTP. */
const LIVE_YIELD_MS = 0;

export class CaptureScheduler {
  private latest: CapturedFrame | null = null;
  private running = false;
  private intervalMs = 0;
  private captureCount = 0;
  private liveChain: Promise<void> = Promise.resolve();
  private forceChain: Promise<unknown> = Promise.resolve();
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private loopGeneration = 0;

  constructor(private readonly getBackend: () => EmulatorBackend) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalMs = 0;
    this.clearIntervalTimer();
    this.captureCount = 0;
    const gen = ++this.loopGeneration;
    void this.runLiveLoop(gen);
  }

  stop(): void {
    this.running = false;
    this.loopGeneration += 1;
    this.clearIntervalTimer();
    this.intervalMs = 0;
    this.latest = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getLatest(): CapturedFrame | null {
    return this.latest;
  }

  getAgeMs(now = Date.now()): number | null {
    if (!this.latest) return null;
    return Math.max(0, now - this.latest.captured_at);
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  setIntervalMs(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error("interval_ms must be a non-negative number");
    }
    if (ms === 0) {
      this.intervalMs = 0;
      this.clearIntervalTimer();
      return;
    }
    if (ms < MIN_INTERVAL || ms > MAX_INTERVAL) {
      throw new Error(
        `interval_ms must be 0 or between ${MIN_INTERVAL} and ${MAX_INTERVAL}`
      );
    }
    this.intervalMs = Math.floor(ms);
    this.clearIntervalTimer();
    this.intervalTimer = setInterval(() => {
      void this.maybeIntervalCapture();
    }, this.intervalMs);
  }

  getCaptureCount(): number {
    return this.captureCount;
  }

  async forceCapture(): Promise<CapturedFrame> {
    const run = async (): Promise<CapturedFrame> => {
      const backend = this.getBackend();
      if (!backend.isRomLoaded()) {
        throw new Error("rom not loaded");
      }
      const frame = await backend.getFramePng();
      const captured: CapturedFrame = {
        data: frame.data,
        width: frame.width,
        height: frame.height,
        frame_id: frame.frame_id,
        captured_at: Date.now(),
      };
      this.latest = captured;
      this.captureCount += 1;
      return captured;
    };
    // Serialize forces with each other; live loop also uses captureOnce under the hood.
    const p = this.forceChain.then(run, run);
    this.forceChain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  }

  private clearIntervalTimer(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async maybeIntervalCapture(): Promise<void> {
    if (!this.running || this.intervalMs <= 0) return;
    const age = this.getAgeMs();
    if (age !== null && age < this.intervalMs) return;
    try {
      await this.forceCapture();
    } catch {
      /* keep last good */
    }
  }

  private async runLiveLoop(gen: number): Promise<void> {
    while (this.running && this.loopGeneration === gen) {
      const backend = this.getBackend();
      if (!backend.isRomLoaded()) {
        await sleep(50);
        continue;
      }
      try {
        await this.forceCapture();
      } catch {
        /* keep last good; back off slightly */
        await sleep(30);
        continue;
      }
      if (LIVE_YIELD_MS > 0) await sleep(LIVE_YIELD_MS);
      else await sleep(0); // always yield once
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
