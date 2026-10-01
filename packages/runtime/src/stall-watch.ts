/**
 * C8: a turn whose engine goes quiet for too long is stuck (an MCP server that never answers, an
 * unexpected interactive prompt, an app-server that stopped sending events). The watch counts
 * quiet *checks* rather than wall-clock time, so a laptop waking from sleep does not find every
 * turn "stalled": checks don't run while it sleeps.
 */
export interface StallWatchOptions {
  /** How often the turn is checked. */
  tickMs: number;
  /** Quiet this long with nothing in flight: stalled. */
  quietMs: number;
  /** Quiet this long while a tool runs (a long command, a computer task): stalled. */
  toolQuietMs: number;
}

export const DEFAULT_STALL_WATCH: StallWatchOptions = {
  tickMs: 30_000,
  quietMs: 8 * 60_000,
  toolQuietMs: 20 * 60_000,
};

export class StallWatch {
  private quietTicks = 0;
  private readonly tools = new Set<string>();
  private waitingOnUser = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private fired = false;

  constructor(
    private readonly options: StallWatchOptions,
    private readonly onStall: (quietMs: number) => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.check(), this.options.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Any engine event is a sign of life. */
  activity(event?: { type: string; toolUseId?: string }): void {
    this.quietTicks = 0;
    if (event?.type === "tool_started" && event.toolUseId) this.tools.add(event.toolUseId);
    if (event?.type === "tool_completed" && event.toolUseId) this.tools.delete(event.toolUseId);
  }

  /** A card in front of the user: waiting for them is not a stall. */
  async whileWaitingOnUser<T>(run: () => Promise<T>): Promise<T> {
    this.waitingOnUser += 1;
    try {
      return await run();
    } finally {
      this.waitingOnUser -= 1;
      this.quietTicks = 0;
    }
  }

  private check(): void {
    if (this.fired || this.waitingOnUser > 0) return;
    this.quietTicks += 1;
    const limit = this.tools.size > 0 ? this.options.toolQuietMs : this.options.quietMs;
    const quiet = this.quietTicks * this.options.tickMs;
    if (quiet >= limit) {
      this.fired = true;
      this.onStall(quiet);
    }
  }
}

/** Sent to the engine when a stalled turn is resumed (once). */
export const STALL_RESUME_REMINDER =
  "<system_reminder>Your previous attempt stalled (no progress for several minutes) and was " +
  "stopped by OpenBot. Continue from where you were: check what is already done before " +
  "repeating any step, and finish the user's request.</system_reminder>";
