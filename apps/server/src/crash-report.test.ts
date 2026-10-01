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

describe("harness reminders (K2)", () => {
  it("a card nobody answered because the turn ended is reported as not refused", async () => {
    const { harnessReminders } = await import("./reminders.js");
    home = await mkdtemp(join(tmpdir(), "openbot-k2-"));
    ctx = await createCoreContext({
      clock: new FakeClock(new Date("2026-10-01T10:00:00Z")),
      config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
      disableNdjson: true,
    });
    ctx.repos.setupState.patch({ completedAt: ctx.clock.now().toISOString() });
    const chief = ensureChiefOfStaff(ctx)!;
    ctx.repos.turns.create({
      id: "turn_1",
      botId: chief.id,
      chainId: "chn_1",
      engine: "claude",
      model: "m",
      status: "interrupted",
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: "2026-10-01T09:59:00.000Z",
    });
    ctx.repos.approvals.create({
      id: "apr_1",
      kind: "tool",
      botId: chief.id,
      chainId: "chn_1",
      summary: "Run a command: npm publish",
      detail: "",
      status: "pending",
      expiresAt: "2026-10-01T10:30:00.000Z",
      createdAt: "2026-10-01T09:59:30.000Z",
    });
    ctx.repos.approvals.resolve("apr_1", "expired");
    const text = harnessReminders(ctx, chief).join("\n");
    expect(text).toMatch(/NOT refused by the user: "Run a command: npm publish"/);
    expect(text).toMatch(/previous turn was interrupted/);
  });
});
