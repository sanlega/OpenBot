import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { writeFileSync } from "node:fs";

/** One process of a screen's desktop. */
export type ComponentName = "xvfb" | "wm" | "vnc" | "browser";

export interface ComponentSpec {
  name: ComponentName;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Runs before every (re)start: stale locks, profile preferences, forgetting sign-ins. */
  prepare?: () => void | Promise<void>;
  /** Resolves once the component is usable (its socket or port is there). */
  ready?: () => Promise<void>;
  /** Liveness beyond "the process exists": false twice in a row (same process) restarts it. */
  probe?: () => Promise<boolean>;
  /** Raised OOM score (a renderer eating memory dies before the desktop). */
  oomScoreAdj?: number;
}

export interface ComponentStatus {
  name: ComponentName;
  up: boolean;
  pid?: number;
  restartsInWindow: number;
  crashloop: boolean;
  downReason?: string;
  lastExitAt?: string;
}

export type SupervisorEvent =
  | { kind: "desktop_component_exit"; display: number; name: ComponentName; reason: string }
  | { kind: "desktop_component_restart"; display: number; name: ComponentName; attempt: number }
  | { kind: "desktop_component_crashloop"; display: number; name: ComponentName; reason: string }
  | { kind: "desktop_component_unresponsive"; display: number; name: ComponentName };

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface SupervisorOptions {
  display: number;
  spawn?: SpawnFn;
  onEvent?: (event: SupervisorEvent) => void;
  now?: () => number;
  /** How often probes run (ms); 0 turns them off (tests drive `tick()` themselves). */
  probeIntervalMs?: number;
  /** A component this new is not probed yet (it is still starting). */
  probeGraceMs?: number;
}

/** Grok Bot's numbers: 8 restarts in 10 minutes is a crashloop; backoff 1 s doubling to 30 s. */
export const CRASHLOOP_WINDOW_MS = 10 * 60_000;
export const CRASHLOOP_MAX_RESTARTS = 8;
export const backoffMs = (restarts: number): number => Math.min(30_000, 1_000 * 2 ** restarts);

/** Keeps the last bytes a process wrote: the reason it died is almost always there. */
export class RingLog {
  private chunks: string[] = [];
  private size = 0;

  constructor(private readonly maxChars = 32_768) {}

  write(text: string): void {
    this.chunks.push(text);
    this.size += text.length;
    while (this.size > this.maxChars && this.chunks.length > 1) {
      this.size -= (this.chunks.shift() as string).length;
    }
    if (this.size > this.maxChars) {
      const only = (this.chunks[0] as string).slice(-this.maxChars);
      this.chunks = [only];
      this.size = only.length;
    }
  }

  text(): string {
    return this.chunks.join("");
  }

  /** The last `n` non-empty lines. */
  tail(n: number): string[] {
    return this.text()
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(-n);
  }
}

const DOWN_REASONS: Array<[RegExp, string]> = [
  [/address already in use|EADDRINUSE|could not bind|bind.*failed/i, "port-in-use"],
  [/server is already active for display|lock file/i, "display-locked"],
  [/profile appears to be in use|ProcessSingleton|SingletonLock/i, "profile-locked"],
  [/cannot open display|can't open display|unable to open display|missing X server/i, "no-display"],
  [/out of memory|cannot allocate memory|oom/i, "oom"],
  [/XIO|fatal IO error|X connection to .* broken/i, "x-io-error"],
  [/\bglx\b/i, "glx"],
];

/** Why a component went down, from its exit and the last lines it wrote. */
export function classifyDownReason(
  code: number | null,
  signal: string | null,
  logTail: string,
): string {
  for (const [re, reason] of DOWN_REASONS) if (re.test(logTail)) return reason;
  if (signal) return `signal-${signal}`;
  return `exit-${code ?? "unknown"}`;
}

interface Component {
  spec: ComponentSpec;
  order: number;
  child?: ChildProcess;
  restarts: number[];
  crashloop: boolean;
  downReason?: string;
  lastExitAt?: number;
  startedAt?: number;
  log: RingLog;
  timer?: ReturnType<typeof setTimeout>;
  /** Killed on purpose to be started again at once (a probe failure, a forced relaunch). */
  relaunch?: boolean;
  probeFailures: number;
  starting?: Promise<void>;
}

/**
 * Supervises one screen's desktop (Xvfb, window manager, VNC, browser), Grok Bot style: every
 * process is restarted when it dies, with backoff; a process that keeps dying is marked as a
 * crashloop and left alone until the storm passes; the first component is the group's root
 * (without Xvfb nothing else can run), so its death restarts the whole group in order.
 */
export class DesktopSupervisor {
  private readonly components: Component[];
  private readonly spawn: SpawnFn;
  private readonly now: () => number;
  private stopped = false;
  private probeTimer: ReturnType<typeof setInterval> | undefined;
  private groupRestart: Promise<void> | undefined;

  constructor(
    specs: ComponentSpec[],
    private readonly options: SupervisorOptions,
  ) {
    this.components = specs.map((spec, order) => ({
      spec,
      order,
      restarts: [],
      crashloop: false,
      log: new RingLog(),
      probeFailures: 0,
    }));
    this.spawn = options.spawn ?? nodeSpawn;
    this.now = options.now ?? Date.now;
  }

  /** Starts every component in order: the root first and ready, then the rest. */
  async start(): Promise<void> {
    const [root, ...rest] = this.components;
    if (root) await this.startComponent(root);
    await Promise.all(rest.map((c) => this.startComponent(c)));
    const interval = this.options.probeIntervalMs ?? 10_000;
    if (interval > 0 && !this.probeTimer) {
      this.probeTimer = setInterval(() => void this.tick(), interval);
      this.probeTimer.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.probeTimer) clearInterval(this.probeTimer);
    for (const c of this.components) {
      if (c.timer) clearTimeout(c.timer);
      killGroup(c.child);
    }
  }

  status(): ComponentStatus[] {
    const now = this.now();
    return this.components.map((c) => ({
      name: c.spec.name,
      up: isAlive(c.child),
      ...(c.child?.pid ? { pid: c.child.pid } : {}),
      restartsInWindow: c.restarts.filter((t) => now - t < CRASHLOOP_WINDOW_MS).length,
      crashloop: c.crashloop,
      ...(c.downReason ? { downReason: c.downReason } : {}),
      ...(c.lastExitAt ? { lastExitAt: new Date(c.lastExitAt).toISOString() } : {}),
    }));
  }

  /** The last lines a component wrote (diagnostics). */
  logTail(name: ComponentName, lines = 20): string[] {
    return this.find(name)?.log.tail(lines) ?? [];
  }

  /** Kills a component and starts it again at once (not counted as a crash). */
  async relaunch(name: ComponentName): Promise<void> {
    const c = this.find(name);
    if (!c || this.stopped) return;
    if (!isAlive(c.child)) {
      if (c.timer) clearTimeout(c.timer);
      c.crashloop = false;
      await this.startComponent(c);
      return;
    }
    c.relaunch = true;
    await new Promise<void>((resolve) => {
      c.child?.once("exit", () => resolve());
      killGroup(c.child);
    });
    await c.starting;
  }

  /** Throws a reason a bot can act on when a component can't be used right now. */
  assertUsable(name: ComponentName): void {
    const c = this.find(name);
    if (!c) return;
    if (c.crashloop) {
      throw new Error(
        `the ${label(name)} on this screen keeps crashing (${c.downReason ?? "unknown"}); ` +
          "it will be retried in a few minutes, or recreate the computer in Settings > Computer",
      );
    }
  }

  /** One probe round: a process that is alive but stopped answering is restarted. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    for (const c of this.components) {
      // The storm passed: try again.
      if (c.crashloop && c.restarts.every((t) => now - t >= CRASHLOOP_WINDOW_MS)) {
        c.crashloop = false;
        c.restarts = [];
        if (!isAlive(c.child) && c.order !== 0) void this.startComponent(c);
      }
      const probe = c.spec.probe;
      if (!probe || !isAlive(c.child) || c.relaunch) continue;
      if (now - (c.startedAt ?? now) < (this.options.probeGraceMs ?? 30_000)) continue;
      const pid = c.child?.pid;
      const ok = await probe().catch(() => false);
      if (c.child?.pid !== pid) continue;
      c.probeFailures = ok ? 0 : c.probeFailures + 1;
      if (c.probeFailures >= 2) {
        c.probeFailures = 0;
        this.options.onEvent?.({
          kind: "desktop_component_unresponsive",
          display: this.options.display,
          name: c.spec.name,
        });
        // Killed, not relaunched by hand: its exit goes through the normal restart policy.
        killGroup(c.child);
      }
    }
  }

  private find(name: ComponentName): Component | undefined {
    return this.components.find((c) => c.spec.name === name);
  }

  private startComponent(c: Component): Promise<void> {
    const run = async () => {
      if (this.stopped) return;
      await c.spec.prepare?.();
      if (this.stopped) return;
      const child = this.spawn(c.spec.command, c.spec.args, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...(c.spec.env ? { env: c.spec.env } : {}),
      });
      c.child = child;
      c.startedAt = this.now();
      c.probeFailures = 0;
      child.stdout?.on("data", (chunk: Buffer) => c.log.write(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => c.log.write(chunk.toString("utf8")));
      child.on("error", (error) => c.log.write(`spawn error: ${error.message}\n`));
      child.once("exit", (code, signal) => this.onExit(c, child, code, signal));
      if (c.spec.oomScoreAdj !== undefined && child.pid) {
        try {
          writeFileSync(`/proc/${child.pid}/oom_score_adj`, String(c.spec.oomScoreAdj));
        } catch {
          // Not Linux, or not allowed: the process just keeps the default score.
        }
      }
      await c.spec.ready?.();
    };
    const starting = run();
    c.starting = starting.catch(() => undefined);
    return starting;
  }

  private onExit(c: Component, child: ChildProcess, code: number | null, signal: string | null) {
    if (c.child !== child) return; // an older process of this component
    c.lastExitAt = this.now();
    if (this.stopped) return;
    if (c.relaunch) {
      c.relaunch = false;
      void this.startComponent(c);
      return;
    }
    const reason = classifyDownReason(code, signal, c.log.tail(6).join("\n"));
    c.downReason = reason;
    const display = this.options.display;
    this.options.onEvent?.({ kind: "desktop_component_exit", display, name: c.spec.name, reason });
    if (c.order === 0) {
      // Without the X server nothing else on this screen works: restart the group in order.
      this.groupRestart ??= this.restartGroup(c).finally(() => {
        this.groupRestart = undefined;
      });
      return;
    }
    this.scheduleRestart(c, reason);
  }

  private scheduleRestart(c: Component, reason: string): void {
    const now = this.now();
    c.restarts = c.restarts.filter((t) => now - t < CRASHLOOP_WINDOW_MS);
    if (c.restarts.length >= CRASHLOOP_MAX_RESTARTS) {
      c.crashloop = true;
      this.options.onEvent?.({
        kind: "desktop_component_crashloop",
        display: this.options.display,
        name: c.spec.name,
        reason,
      });
      return;
    }
    const delay = backoffMs(c.restarts.length);
    c.restarts.push(now);
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      c.timer = undefined;
      if (this.stopped || isAlive(c.child)) return;
      this.options.onEvent?.({
        kind: "desktop_component_restart",
        display: this.options.display,
        name: c.spec.name,
        attempt: c.restarts.length,
      });
      void this.startComponent(c).catch((error: unknown) => {
        c.log.write(`restart failed: ${String(error)}\n`);
      });
    }, delay);
    c.timer.unref?.();
  }

  private async restartGroup(root: Component): Promise<void> {
    const now = this.now();
    root.restarts = root.restarts.filter((t) => now - t < CRASHLOOP_WINDOW_MS);
    if (root.restarts.length >= CRASHLOOP_MAX_RESTARTS) {
      root.crashloop = true;
      this.options.onEvent?.({
        kind: "desktop_component_crashloop",
        display: this.options.display,
        name: root.spec.name,
        reason: root.downReason ?? "unknown",
      });
      return;
    }
    const delay = backoffMs(root.restarts.length);
    root.restarts.push(now);
    // The others are stopped on purpose: their exits are not crashes.
    const others = this.components.filter((c) => c !== root);
    for (const c of others) {
      if (c.timer) clearTimeout(c.timer);
      const child = c.child;
      c.child = undefined;
      killGroup(child);
    }
    await new Promise((resolve) => setTimeout(resolve, delay).unref?.());
    if (this.stopped) return;
    this.options.onEvent?.({
      kind: "desktop_component_restart",
      display: this.options.display,
      name: root.spec.name,
      attempt: root.restarts.length,
    });
    try {
      await this.startComponent(root);
      await Promise.all(others.map((c) => this.startComponent(c)));
    } catch (error) {
      root.log.write(`group restart failed: ${String(error)}\n`);
    }
  }
}

function label(name: ComponentName): string {
  return name === "browser"
    ? "browser"
    : name === "vnc"
      ? "live view server"
      : name === "wm"
        ? "window manager"
        : "X display";
}

function isAlive(child: ChildProcess | undefined): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function killGroup(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
}
