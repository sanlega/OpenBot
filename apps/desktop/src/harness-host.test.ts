import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessHost } from "./harness-host.js";
import { classifyHarnessExit, CRASH_MARKER } from "./crash-marker.js";

let home = "";
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = "";
});
const tempHome = () => (home = mkdtempSync(join(tmpdir(), "openbot-host-")));

describe("HarnessHost", () => {
  it("restarts after an unexpected exit", async () => {
    const fork = vi.fn();
    const child = {
      pid: 42,
      listeners: new Map<string, (...args: unknown[]) => void>(),
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, listener);
      },
      kill: vi.fn(),
    };
    fork.mockReturnValue(child);

    const host = new HarnessHost({
      port: 4577,
      openbotHome: tempHome(),
      fork: { fork },
      harnessEntry: "/tmp/server-main.js",
      maxRestartDelayMs: 1000,
    });

    host.start();
    child.listeners.get("spawn")?.();
    child.listeners.get("exit")?.(1);

    await vi.waitFor(() => expect(fork).toHaveBeenCalledTimes(2), { timeout: 3000 });
    host.stop();
    // D3: the crash is left for the next harness to report.
    const marker = JSON.parse(readFileSync(join(home, "logs", CRASH_MARKER), "utf8"));
    expect(marker).toMatchObject({ class: "nonzero_exit", code: 1 });
  });

  it("an intentional restart (exit 0) is not a crash", () => {
    expect(classifyHarnessExit(0)).toBeUndefined();
    expect(classifyHarnessExit(null)).toBe("signal_exit");
  });

  it("does not restart after an intentional stop", async () => {
    const fork = vi.fn();
    const child = {
      listeners: new Map<string, (...args: unknown[]) => void>(),
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, listener);
      },
      kill: vi.fn(),
    };
    fork.mockReturnValue(child);

    const host = new HarnessHost({
      port: 4577,
      openbotHome: tempHome(),
      fork: { fork },
      harnessEntry: "/tmp/server-main.js",
    });

    host.start();
    host.stop();
    child.listeners.get("exit")?.(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(fork).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, "logs", CRASH_MARKER))).toBe(false);
  });
});
