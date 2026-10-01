import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { promisify } from "node:util";
import type { BoxCheck, ExecResult } from "@openbot/contracts";
import type { ScreenHealth } from "./display-session.js";
import { rfbGreets } from "./probes.js";

const execFileAsync = promisify(execFile);

/** What the doctor needs from the box (injected in tests). */
export interface DoctorDeps {
  readFile(path: string): string;
  /** Runs a command as the bots' user, the way `vm_shell` does. */
  runAsBox(command: string): Promise<ExecResult>;
  chromiumVersion(): Promise<string>;
  fetchProbe(url: string): Promise<{ status: number; date?: string }>;
  screens(): ScreenHealth[];
  /** The browser processes' pids per display (the ones with a DevTools port, no `--type=`). */
  browserPids(): number[];
  freeBytes(path: string): number;
  rfb(port: number): Promise<boolean>;
  now(): number;
  workspace: string;
}

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * The box's self-checks, Grok Bot's `box-doctor` adapted to OpenBot: one PASS/FAIL line each, so
 * the owner (and a bug report) can tell which recovery the machine needs.
 */
export async function runBoxDoctor(deps: DoctorDeps): Promise<BoxCheck[]> {
  const checks: BoxCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const safe = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      add(name, false, error instanceof Error ? error.message : String(error));
    }
  };

  await safe("machine-id", async () => {
    const id = deps.readFile("/etc/machine-id").trim();
    let dbus = "";
    try {
      dbus = deps.readFile("/var/lib/dbus/machine-id").trim();
    } catch {
      // Checked below.
    }
    add(
      "machine-id",
      HEX32.test(id) && dbus === id,
      HEX32.test(id) ? (dbus === id ? id : "differs from D-Bus's copy") : "not 32 hex characters",
    );
  });

  await safe("browser", async () => {
    const version = (await deps.chromiumVersion()).trim();
    add("browser", /chromium/i.test(version), version || "no version");
  });

  await safe("browser file descriptors", async () => {
    const pids = deps.browserPids();
    if (pids.length === 0) {
      add("browser file descriptors", true, "no browser running");
      return;
    }
    const worst = pids
      .map((pid) => {
        const open = fdCount(pid);
        const limit = softFdLimit(deps.readFile(`/proc/${pid}/limits`));
        return { pid, open, limit, ratio: limit ? open / limit : 0 };
      })
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (!worst) return;
    add(
      "browser file descriptors",
      worst.ratio < 0.9,
      `${worst.open} of ${worst.limit ?? "unlimited"} open (pid ${worst.pid})`,
    );
  });

  await safe("internet", async () => {
    const probe = await deps.fetchProbe("https://www.google.com/generate_204");
    add("internet", probe.status === 204, `status ${probe.status}`);
    if (probe.date) {
      const skew = Math.abs(deps.now() - Date.parse(probe.date)) / 1000;
      add(
        "clock",
        Number.isFinite(skew) && skew <= 60,
        Number.isFinite(skew) ? `${Math.round(skew)} s off` : "unreadable",
      );
    }
  });

  for (const screen of deps.screens()) {
    const down = screen.components.filter((c) => !c.up || c.crashloop);
    const vncPort = 5900 + screen.display;
    const greets = await deps.rfb(vncPort).catch(() => false);
    add(
      `screen :${screen.display}`,
      down.length === 0 && greets,
      down.length > 0
        ? down
            .map(
              (c) => `${c.name} ${c.crashloop ? "crashlooping" : "down"} (${c.downReason ?? "?"})`,
            )
            .join(", ")
        : greets
          ? `up (${screen.botId})`
          : "live view does not answer",
    );
  }

  await safe("workspace", async () => {
    const probe = `${deps.workspace}/.openbot-doctor-${process.pid}`;
    const r = await deps.runAsBox(`touch '${probe}' && rm -f '${probe}' && echo ok`);
    add(
      "workspace",
      r.code === 0 && r.stdout.includes("ok"),
      r.code === 0
        ? `${deps.workspace} writable`
        : (r.stderr.trim() || "not writable").slice(0, 200),
    );
  });

  await safe("isolation", async () => {
    // The bots' commands must not reach the daemon's secrets, the browser profiles, or the
    // desktop's own services.
    const r = await deps.runAsBox(
      [
        "fail=0",
        "cat /proc/1/environ >/dev/null 2>&1 && { echo 'reads init environment'; fail=1; }",
        "for p in $(pgrep -f '^node /opt/openbot/desktop-daemon'); do cat /proc/$p/environ >/dev/null 2>&1 && { echo 'reads daemon environment'; fail=1; }; done",
        "ls /data/browser >/dev/null 2>&1 && { echo 'reads browser profiles'; fail=1; }",
        'curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${OPENBOT_CONTROL_PORT:-8787}/health" && { echo "reaches the daemon"; fail=1; }',
        "curl -s -o /dev/null --max-time 2 http://127.0.0.1:9221/json/version && { echo 'reaches a browser DevTools port'; fail=1; }",
        "[ \"$(id -u)\" = 0 ] && { echo 'runs as root'; fail=1; }",
        "exit $fail",
      ].join("\n"),
    );
    add(
      "isolation",
      r.code === 0,
      r.code === 0 ? "bot commands are confined" : r.stdout.trim().split("\n").join(", "),
    );
  });

  await safe("firewall", async () => {
    const state = deps.readFile("/run/openbot/firewall").trim();
    add("firewall", state.startsWith("on"), state || "unknown");
  });

  await safe("disk", async () => {
    const free = Math.min(deps.freeBytes(deps.workspace), deps.freeBytes("/"));
    add("disk", free > 1024 ** 3, `${(free / 1024 ** 3).toFixed(1)} GB free`);
  });

  await safe("memory pressure", async () => {
    const psi = deps.readFile("/proc/pressure/memory");
    const avg = Number(/full avg60=([\d.]+)/.exec(psi)?.[1] ?? 0);
    add("memory pressure", avg < 10, `${avg}% stalled (last minute)`);
  });

  return checks;
}

/** `Max open files` soft limit from `/proc/<pid>/limits`. */
export function softFdLimit(limits: string): number | undefined {
  const line = limits.split("\n").find((l) => l.startsWith("Max open files"));
  const soft = line?.slice("Max open files".length).trim().split(/\s+/)[0];
  if (!soft || soft === "unlimited") return undefined;
  const n = Number(soft);
  return Number.isFinite(n) ? n : undefined;
}

function fdCount(pid: number): number {
  try {
    return readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    return 0;
  }
}

/** The real box: Linux `/proc`, Chromium, the network. */
export function liveDoctorDeps(options: {
  runAsBox: (command: string) => Promise<ExecResult>;
  screens: () => ScreenHealth[];
  workspace: string;
}): DoctorDeps {
  return {
    readFile: (path) => readFileSync(path, "utf8"),
    runAsBox: options.runAsBox,
    async chromiumVersion() {
      const { stdout } = await execFileAsync("chromium", ["--version"], { timeout: 10_000 });
      return stdout;
    },
    async fetchProbe(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return { status: res.status, date: res.headers.get("date") ?? undefined };
    },
    screens: options.screens,
    browserPids() {
      const pids: number[] = [];
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
          if (
            /chrom/.test(cmd[0] ?? "") &&
            cmd.some((a) => a.startsWith("--remote-debugging-port=")) &&
            !cmd.some((a) => a.startsWith("--type="))
          ) {
            pids.push(Number(entry));
          }
        } catch {
          // Gone meanwhile.
        }
      }
      return pids;
    },
    freeBytes(path) {
      const fs = statfsSync(path);
      return fs.bavail * fs.bsize;
    },
    rfb: (port) => rfbGreets(port),
    now: () => Date.now(),
    workspace: options.workspace,
  };
}
