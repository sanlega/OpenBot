import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { ExecResult } from "@openbot/contracts";

export interface ExecRequest {
  command: string;
  /** Working directory inside the machine (default: the shared workspace). */
  cwd?: string;
  timeoutMs?: number;
  /** Written to the command's standard input, then closed. */
  stdin?: string;
}

/** Longest a command may run, whatever the caller asks for. */
export const MAX_EXEC_MS = 10 * 60_000;
const DEFAULT_EXEC_MS = 2 * 60_000;
/** Characters kept of each stream (the end, where errors and results usually are). */
export const MAX_EXEC_OUTPUT = 60_000;

/**
 * Where bots' own installs live inside the machine: on the browser volume, so `pip install
 * --user`, `npm install -g` and tool configs survive a new container (an app update).
 */
export const BOT_HOME = "/data/home";

/**
 * Processes (threads included) the bot user may have at once: a runaway command or a fork bomb
 * hits this before it starves the desktop of process ids.
 */
export const BOX_MAX_PROCESSES = 1024;

export interface ExecIdentity {
  /** The unprivileged user commands run as (`box`); unset when the daemon isn't root (tests). */
  uid?: number;
  gid?: number;
  /** Secrets of the daemon: any variable whose value contains one is removed from the command's environment. */
  secrets?: string[];
}

/** The user commands run as, when the daemon itself runs as root inside the container. */
export function defaultExecIdentity(env: NodeJS.ProcessEnv = process.env): ExecIdentity {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const uid = Number(env.OPENBOT_BOX_UID ?? 1000);
  return isRoot && Number.isInteger(uid) && uid > 0 ? { uid, gid: uid } : {};
}

/** The command's environment: the daemon's own, minus anything carrying a daemon secret. */
export function commandEnv(base: NodeJS.ProcessEnv, secrets: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const live = secrets.filter((s) => s.length >= 8);
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key === "OPENBOT_CONTROL_TOKEN") continue;
    if (live.some((secret) => value.includes(secret))) continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: BOT_HOME,
    USER: "box",
    LOGNAME: "box",
    npm_config_prefix: `${BOT_HOME}/.npm-global`,
    PIP_BREAK_SYSTEM_PACKAGES: "1",
    PATH: `${BOT_HOME}/.local/bin:${BOT_HOME}/.npm-global/bin:${base.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`,
    // Commands are not interactive: anything asking for input gets end-of-file.
    DEBIAN_FRONTEND: "noninteractive",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * How a command is started: a small wrapper makes it the first thing the OOM killer takes (a
 * memory hog dies before the desktop does), caps its processes, and lowers its CPU priority so
 * the screens and the fast loop stay responsive during an `npm install`.
 */
export function execArgv(command: string): { file: string; args: string[] } {
  const wrapper = [
    "echo 500 > /proc/self/oom_score_adj 2>/dev/null",
    `ulimit -u ${BOX_MAX_PROCESSES} 2>/dev/null`,
    'exec nice -n 10 bash -lc "$0"',
  ].join("; ");
  return { file: "bash", args: ["-c", wrapper, command] };
}

/** Runs a shell command in the machine for a bot (the engine's shell, D-033). */
export function runExec(
  request: ExecRequest,
  defaults: { cwd: string },
  identity: ExecIdentity = defaultExecIdentity(),
): Promise<ExecResult> {
  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_EXEC_MS, 1_000), MAX_EXEC_MS);
  try {
    mkdirSync(BOT_HOME, { recursive: true });
  } catch {
    // Not fatal: the command still runs with the image's home.
  }
  // The control token is the daemon's own credential, never a command's.
  const env = commandEnv(process.env, identity.secrets);
  const { file, args } = execArgv(request.command);
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: request.cwd ?? defaults.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      ...(identity.uid !== undefined
        ? { uid: identity.uid, gid: identity.gid ?? identity.uid }
        : {}),
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const keep = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (next.length <= MAX_EXEC_OUTPUT) return next;
      truncated = true;
      return next.slice(-MAX_EXEC_OUTPUT);
    };
    child.stdout.on("data", (chunk: Buffer) => (stdout = keep(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = keep(stderr, chunk)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The whole process group: a command's children must not outlive it.
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, truncated });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.stdin ?? "");
  });
}
