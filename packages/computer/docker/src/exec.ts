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

/** Runs a shell command in the machine for a bot (the engine's shell, D-033). */
export function runExec(request: ExecRequest, defaults: { cwd: string }): Promise<ExecResult> {
  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_EXEC_MS, 1_000), MAX_EXEC_MS);
  try {
    mkdirSync(BOT_HOME, { recursive: true });
  } catch {
    // Not fatal: the command still runs with the image's home.
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: BOT_HOME,
    npm_config_prefix: `${BOT_HOME}/.npm-global`,
    PIP_BREAK_SYSTEM_PACKAGES: "1",
    PATH: `${BOT_HOME}/.local/bin:${BOT_HOME}/.npm-global/bin:${process.env.PATH ?? "/usr/bin:/bin"}`,
    // Commands are not interactive: anything asking for input gets end-of-file.
    DEBIAN_FRONTEND: "noninteractive",
    GIT_TERMINAL_PROMPT: "0",
  };
  // The control token is the daemon's own credential, never a command's.
  delete env.OPENBOT_CONTROL_TOKEN;
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", request.command], {
      cwd: request.cwd ?? defaults.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
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
