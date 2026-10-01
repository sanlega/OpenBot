import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { FakeClock } from "@openbot/testkit";
import { ensureChiefOfStaff } from "./chief-of-staff.js";
import { reportPreviousCrash } from "./crash-report.js";

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

describe("reportPreviousCrash (D3)", () => {
  it("tells the owner once, in the Chief's chat, and keeps the marker for a bug report", async () => {
    home = await mkdtemp(join(tmpdir(), "openbot-crash-"));
    ctx = await createCoreContext({
      clock: new FakeClock(new Date("2026-10-01T10:00:00Z")),
      config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
      disableNdjson: true,
    });
    ctx.repos.setupState.patch({ completedAt: ctx.clock.now().toISOString() });
    const chief = ensureChiefOfStaff(ctx)!;
    mkdirSync(join(home, "logs"), { recursive: true });
    writeFileSync(
      join(home, "logs", "harness-crash.json"),
      JSON.stringify({ class: "nonzero_exit", code: 3, exitedAt: "2026-10-01T09:58:00Z" }),
    );

    expect(await reportPreviousCrash(ctx)).toBe(true);
    const thread = ctx.repos.threads.getByBotId(chief.id)!;
    const said = ctx.repos.messages.list({ threadId: thread.id }).map((m) => m.text);
    expect(said.join("\n")).toMatch(/closed unexpectedly .* exited with code 3/);
    expect(existsSync(join(home, "logs", "harness-crash.json.reported"))).toBe(true);
    // Only once.
    expect(await reportPreviousCrash(ctx)).toBe(false);
  });
});
