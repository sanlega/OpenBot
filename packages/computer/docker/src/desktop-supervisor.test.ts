import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  classifyDownReason,
  CRASHLOOP_MAX_RESTARTS,
  DesktopSupervisor,
  RingLog,
  type ComponentSpec,
  type SupervisorEvent,
} from "./desktop-supervisor.js";

/** A process that lives until the test kills it. */
class FakeChild extends EventEmitter {
  static nextPid = 100;
  pid = FakeChild.nextPid++;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(readonly command: string) {
    super();
  }
  die(code: number | null, signal: string | null = null, log = "") {
    if (log) this.stderr.emit("data", Buffer.from(log));
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
  kill() {
    this.die(null, "SIGTERM");
    return true;
  }
}

function harness(extra: Partial<Record<string, Partial<ComponentSpec>>> = {}) {
  const children: FakeChild[] = [];
  const events: SupervisorEvent[] = [];
  const spawn = vi.fn((command: string) => {
    const child = new FakeChild(command);
    children.push(child);
    return child as unknown as ChildProcess;
  });
  const spec = (name: ComponentSpec["name"]): ComponentSpec => ({
    name,
    command: name,
    args: [],
    ...(extra[name] ?? {}),
  });
  const supervisor = new DesktopSupervisor(
    [spec("xvfb"), spec("wm"), spec("vnc"), spec("browser")],
    {
      display: 1,
      spawn,
      onEvent: (e) => events.push(e),
      probeIntervalMs: 0,
      probeGraceMs: 0,
    },
  );
  const latest = (command: string) => children.filter((c) => c.command === command).at(-1)!;
  return { supervisor, children, events, spawn, latest };
}

let killSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  // Killing a process group goes through process.kill(-pid): route it to the fake child.
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
    throw new Error("no such process");
  });
});
afterEach(() => {
  vi.useRealTimers();
  killSpy.mockRestore();
});

describe("DesktopSupervisor", () => {
  it("restarts a component that died, with backoff, and reports why it went down", async () => {
    const h = harness();
    await h.supervisor.start();
    const first = h.latest("browser");
    first.die(null, "SIGSEGV", "Received signal 11 SEGV_MAPERR\n");
    expect(h.supervisor.status().find((c) => c.name === "browser")).toMatchObject({
      up: false,
      downReason: "signal-SIGSEGV",
    });
    await vi.advanceTimersByTimeAsync(backoffMs(0));
    const second = h.latest("browser");
    expect(second).not.toBe(first);
    expect(h.supervisor.status().find((c) => c.name === "browser")?.up).toBe(true);
    expect(h.events.map((e) => e.kind)).toEqual([
      "desktop_component_exit",
      "desktop_component_restart",
    ]);
  });

  it("stops retrying a component that keeps crashing, until the window passes", async () => {
    const h = harness();
    await h.supervisor.start();
    for (let i = 0; i < CRASHLOOP_MAX_RESTARTS; i++) {
      h.latest("vnc").die(1, null, "bind failed: Address already in use\n");
      await vi.advanceTimersByTimeAsync(backoffMs(i));
    }
    h.latest("vnc").die(1, null, "bind failed: Address already in use\n");
    const vnc = h.supervisor.status().find((c) => c.name === "vnc")!;
    expect(vnc).toMatchObject({ crashloop: true, downReason: "port-in-use" });
    expect(h.events.some((e) => e.kind === "desktop_component_crashloop")).toBe(true);
    expect(() => h.supervisor.assertUsable("vnc")).toThrow(/keeps crashing \(port-in-use\)/);

    const spawned = h.spawn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.spawn.mock.calls.length).toBe(spawned);
    // Ten minutes later the storm has passed: the next probe round tries again.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await h.supervisor.tick();
    expect(h.supervisor.status().find((c) => c.name === "vnc")).toMatchObject({
      up: true,
      crashloop: false,
    });
  });

  it("restarts the whole screen in order when the X server dies", async () => {
    const h = harness();
    await h.supervisor.start();
    const before = new Set(h.children);
    h.latest("xvfb").die(1, null, "Fatal server error: Server is already active for display 1\n");
    await vi.advanceTimersByTimeAsync(backoffMs(0));
    const restarted = h.children.filter((c) => !before.has(c)).map((c) => c.command);
    expect(restarted).toEqual(["xvfb", "wm", "vnc", "browser"]);
    expect(h.supervisor.status().every((c) => c.up)).toBe(true);
  });

  it("restarts a component whose probe keeps failing (alive but not answering)", async () => {
    let healthy = true;
    const h = harness({ vnc: { probe: async () => healthy } });
    await h.supervisor.start();
    const vnc = h.latest("vnc");
    healthy = false;
    await h.supervisor.tick();
    expect(vnc.exitCode).toBeNull();
    await h.supervisor.tick();
    expect(vnc.signalCode).toBe("SIGTERM");
    expect(h.events.some((e) => e.kind === "desktop_component_unresponsive")).toBe(true);
    healthy = true;
    await vi.advanceTimersByTimeAsync(backoffMs(0));
    expect(h.latest("vnc")).not.toBe(vnc);
  });

  it("relaunch starts a component again at once and runs its preparation", async () => {
    const prepare = vi.fn();
    const h = harness({ browser: { prepare } });
    await h.supervisor.start();
    const old = h.latest("browser");
    await h.supervisor.relaunch("browser");
    expect(h.latest("browser")).not.toBe(old);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(h.supervisor.status().find((c) => c.name === "browser")?.restartsInWindow).toBe(0);
  });

  it("stop() kills everything and never restarts", async () => {
    const h = harness();
    await h.supervisor.start();
    h.supervisor.stop();
    const spawned = h.spawn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.spawn.mock.calls.length).toBe(spawned);
  });
});

describe("classifyDownReason", () => {
  it("reads the reason from the log first, then the signal or exit code", () => {
    expect(classifyDownReason(1, null, "x11vnc: listen: Address already in use")).toBe(
      "port-in-use",
    );
    expect(classifyDownReason(1, null, "Error: cannot open display: :1")).toBe("no-display");
    expect(classifyDownReason(null, "SIGKILL", "")).toBe("signal-SIGKILL");
    expect(classifyDownReason(3, null, "nothing useful")).toBe("exit-3");
  });
});

describe("RingLog", () => {
  it("keeps only the newest text", () => {
    const log = new RingLog(10);
    log.write("aaaa\n");
    log.write("bbbb\n");
    log.write("cccc\n");
    expect(log.text().length).toBeLessThanOrEqual(10);
    expect(log.tail(1)).toEqual(["cccc"]);
  });
});
