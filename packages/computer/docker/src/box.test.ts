import { describe, expect, it, vi } from "vitest";
import type { ExecResult } from "@openbot/contracts";
import { commandEnv, execArgv, BOT_HOME } from "./exec.js";
import { PackageInstaller, parsePackages } from "./apt-helper.js";
import { runBoxDoctor, softFdLimit, type DoctorDeps } from "./box-doctor.js";

describe("bot commands (A3/A4/A5)", () => {
  it("never pass the daemon's token, under any variable name", () => {
    const env = commandEnv(
      {
        PATH: "/usr/bin",
        OPENBOT_CONTROL_TOKEN: "s3cret-token-value",
        SOMETHING_ELSE: "Bearer s3cret-token-value",
        KEEP: "fine",
      },
      ["s3cret-token-value"],
    );
    expect(env.OPENBOT_CONTROL_TOKEN).toBeUndefined();
    expect(env.SOMETHING_ELSE).toBeUndefined();
    expect(env.KEEP).toBe("fine");
    expect(env.HOME).toBe(BOT_HOME);
    expect(env.PATH).toContain(`${BOT_HOME}/.local/bin`);
  });

  it("run at low priority, first in line for the OOM killer, with a process cap", () => {
    const { file, args } = execArgv("npm install");
    expect(file).toBe("bash");
    expect(args[1]).toContain("oom_score_adj");
    expect(args[1]).toContain("ulimit -u");
    expect(args[1]).toContain("nice -n 10");
    // The command is passed as an argument, never spliced into the wrapper.
    expect(args[2]).toBe("npm install");
  });
});

describe("package helper", () => {
  it("accepts package names only", () => {
    expect(
      parsePackages({ packages: ["ffmpeg", "python3-dev", "libssl3:amd64", "jq=1.6-2.1"] }),
    ).toEqual({
      packages: ["ffmpeg", "python3-dev", "libssl3:amd64", "jq=1.6-2.1"],
    });
    for (const bad of ["-o", "a;rm -rf /", "$(id)", "../x", "", "A b"]) {
      expect(parsePackages({ packages: [bad] })).toHaveProperty("error");
    }
    expect(parsePackages({})).toHaveProperty("error");
  });

  it("refreshes package lists once, then installs one request at a time", async () => {
    const calls: string[] = [];
    let active = 0;
    let overlap = false;
    const run = vi.fn(async (_file: string, args: string[]) => {
      active += 1;
      if (active > 1) overlap = true;
      calls.push(args[0]!);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { code: 0, output: "ok" };
    });
    const installer = new PackageInstaller(run, () => 1_000_000);
    await Promise.all([installer.install(["jq"]), installer.install(["ffmpeg"])]);
    expect(calls).toEqual(["update", "install", "install"]);
    expect(overlap).toBe(false);
    expect(run.mock.calls[1]![1]).toContain("--no-install-recommends");
  });
});

describe("box doctor (A7)", () => {
  const ok: ExecResult = { code: 0, stdout: "ok\n", stderr: "", timedOut: false, truncated: false };
  const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
    readFile: (path) =>
      ({
        "/etc/machine-id": "0123456789abcdef0123456789abcdef\n",
        "/var/lib/dbus/machine-id": "0123456789abcdef0123456789abcdef\n",
        "/run/openbot/firewall": "on (iptables)\n",
        "/proc/pressure/memory":
          "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.50 avg300=0.00 total=0\n",
      })[path] ??
      (() => {
        throw new Error(`no ${path}`);
      })(),
    runAsBox: async () => ok,
    chromiumVersion: async () => "Chromium 130.0.6723.116 built on Debian",
    fetchProbe: async () => ({ status: 204, date: new Date(1_000_000).toUTCString() }),
    screens: () => [
      {
        botId: "bot_a",
        display: 1,
        components: [{ name: "browser", up: true, restartsInWindow: 0, crashloop: false }],
      },
    ],
    browserPids: () => [],
    freeBytes: () => 50 * 1024 ** 3,
    rfb: async () => true,
    now: () => 1_000_000,
    workspace: "/workspace",
    ...over,
  });

  it("passes on a healthy box", async () => {
    const checks = await runBoxDoctor(deps());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "machine-id",
        "browser",
        "internet",
        "clock",
        "screen :1",
        "workspace",
        "isolation",
        "firewall",
        "disk",
      ]),
    );
  });

  it("names what is wrong", async () => {
    const checks = await runBoxDoctor(
      deps({
        runAsBox: async (command) =>
          command.includes("environ")
            ? { ...ok, code: 1, stdout: "reads daemon environment\n" }
            : ok,
        fetchProbe: async () => ({
          status: 204,
          date: new Date(1_000_000 - 120_000).toUTCString(),
        }),
        screens: () => [
          {
            botId: "bot_a",
            display: 2,
            components: [
              {
                name: "browser",
                up: false,
                restartsInWindow: 8,
                crashloop: true,
                downReason: "oom",
              },
            ],
          },
        ],
      }),
    );
    const failed = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.name, c.detail]));
    expect(failed.isolation).toContain("reads daemon environment");
    expect(failed.clock).toContain("120 s off");
    expect(failed["screen :2"]).toContain("browser crashlooping (oom)");
  });

  it("reads the open-files limit", () => {
    expect(
      softFdLimit(
        "Limit Soft Limit Hard Limit Units\nMax open files            1024                 524288               files\n",
      ),
    ).toBe(1024);
    expect(softFdLimit("Max open files unlimited unlimited files")).toBeUndefined();
  });
});
