import { afterEach, describe, expect, it } from "vitest";
import { newId, type Bot, type Delegation, type OBEvent } from "@openbot/contracts";
import {
  DelegationTracker,
  MAX_OPEN_PER_REQUESTER,
  MAX_ROUND_TRIPS,
  STALL_AFTER_MS,
} from "./delegations.js";
import { createTestContext, type TestContext } from "./test-helpers.js";

let t: TestContext | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

function bot(name: string, overrides: Partial<Bot> = {}): Bot {
  return {
    id: newId("bot"),
    slug: name.toLowerCase(),
    name,
    description: name,
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "docker",
    connectors: [],
    limits: {},
    ...overrides,
  };
}

async function setup() {
  t = await createTestContext();
  const { ctx } = t;
  const chief = bot("Chief", { isChiefOfStaff: true });
  const worker = bot("Worker");
  for (const b of [chief, worker]) {
    ctx.repos.bots.create(b);
    if (!ctx.repos.threads.getByBotId(b.id)) {
      ctx.repos.threads.create({
        id: newId("thread"),
        botId: b.id,
        kind: "dm",
        createdAt: t.clock.now().toISOString(),
      });
    }
  }
  const tracker = new DelegationTracker(ctx);
  const woken: Delegation[] = [];
  tracker.onWake = (d) => {
    woken.push(d);
  };
  const events: OBEvent[] = [];
  ctx.eventBus.subscribe((e) => events.push(e));
  const open = (text = "Deploy the site", from = chief, to = worker) => {
    const r = tracker.open({
      requesterBotId: from.id,
      assigneeBotId: to.id,
      chainId: "chn_1",
      text,
    });
    if (!r.ok) throw new Error(r.reason);
    return r.delegation;
  };
  return { ctx, chief, worker, tracker, woken, events, open };
}

describe("DelegationTracker", () => {
  it("wakes the requester once, with the worker's closing text, when its turn completes", async () => {
    const { ctx, chief, tracker, woken, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    expect(tracker.get(d.id)).toMatchObject({ state: "working", engine: "codex" });

    await tracker.turnEnded(d.id, { status: "completed", text: "Site is live at x.example" });
    await tracker.turnEnded(d.id, { status: "completed", text: "again" });

    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ state: "completed", result: "Site is live at x.example" });
    // The user sees a card in the requester's thread, authored by the worker.
    const thread = ctx.repos.threads.getByBotId(chief.id)!;
    const cards = ctx.repos.messages.list({ threadId: thread.id });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "result", author: { type: "bot" } });
    expect(cards[0]!.text).toContain("Site is live");
  });

  it.each([
    ["failed", { status: "failed" as const, reason: "engine crashed" }, "failed"],
    ["refused", { status: "refused" as const, reason: "chain is paused" }, "failed"],
    ["interrupted", { status: "interrupted" as const, reason: "stopped" }, "interrupted"],
  ])("a %s turn is never silent: the requester hears why", async (_n, outcome, state) => {
    const { tracker, woken, open } = await setup();
    const d = open();
    await tracker.turnEnded(d.id, outcome);
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ state, statusMessage: outcome.reason });
  });

  it("a worker that asked the user a question stays blocked and does not wake the requester", async () => {
    const { ctx, chief, worker, tracker, woken, open } = await setup();
    const d = open();
    await tracker.started(d.id, "claude");
    await tracker.needsAnswer(worker.id, "waiting for the user: credentials");
    await tracker.turnEnded(d.id, { status: "completed", text: "Asked for credentials." });
    expect(tracker.get(d.id)).toMatchObject({ state: "input_required" });
    expect(woken).toHaveLength(0);
    expect(
      ctx.repos.messages.list({ threadId: ctx.repos.threads.getByBotId(chief.id)!.id }),
    ).toHaveLength(0);

    // The answer resumes the same task.
    await tracker.answered(worker.id);
    expect(tracker.get(d.id)).toMatchObject({ state: "working" });
    await tracker.turnEnded(d.id, { status: "completed", text: "Deployed." });
    expect(woken).toHaveLength(1);
    expect(woken[0]!.state).toBe("completed");
  });

  it("a blocker reported by the worker wakes the requester when the turn ends", async () => {
    const { worker, tracker, woken, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    const routed = await tracker.report(worker.id, "blocker", "No hosting account");
    expect(routed?.id).toBe(d.id);
    expect(woken).toHaveLength(0);
    await tracker.turnEnded(d.id, { status: "completed", text: "Blocked, see message." });
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ state: "input_required", wakeKind: "blocked" });
    expect(woken[0]!.statusMessage).toBe("No hosting account");
  });

  it("does not route message_user of a bot that has no open task", async () => {
    const { worker, tracker } = await setup();
    expect(await tracker.report(worker.id, "result", "hi")).toBeUndefined();
  });

  it("a follow-up to the same worker continues the same delegation", async () => {
    const { tracker, open } = await setup();
    const first = open("Investigate hosting");
    const second = open("Use Vercel");
    expect(second.id).toBe(first.id);
    expect(tracker.get(first.id)!.roundTrips).toBe(2);
  });

  it("caps the back and forth and the tasks in flight", async () => {
    const { ctx, chief, worker, tracker, open } = await setup();
    for (let i = 0; i < MAX_ROUND_TRIPS; i++) open(`step ${i}`);
    const refused = tracker.open({
      requesterBotId: chief.id,
      assigneeBotId: worker.id,
      chainId: "chn_1",
      text: "one more",
    });
    expect(refused.ok).toBe(false);

    const many = await setup();
    for (let i = 0; i < MAX_OPEN_PER_REQUESTER; i++) {
      const w = bot(`W${i}`);
      many.ctx.repos.bots.create(w);
      many.ctx.repos.threads.create({
        id: newId("thread"),
        botId: w.id,
        kind: "dm",
        createdAt: new Date().toISOString(),
      });
      many.open("job", many.chief, w);
    }
    const extra = many.tracker.open({
      requesterBotId: many.chief.id,
      assigneeBotId: many.worker.id,
      chainId: "chn_1",
      text: "job",
    });
    expect(extra.ok).toBe(false);
    void ctx;
  });

  it("delivers a wake that was owed when the harness restarted, and interrupts running work", async () => {
    const { tracker, woken, open } = await setup();
    const running = open("running job");
    await tracker.started(running.id, "codex");
    await tracker.recover();
    expect(tracker.get(running.id)).toMatchObject({ state: "interrupted" });
    expect(woken.map((d) => d.id)).toEqual([running.id]);
    // Recovering again delivers nothing twice.
    await tracker.recover();
    expect(woken).toHaveLength(1);
  });

  it("tells the requester once when a working task shows no activity", async () => {
    const { ctx, tracker, woken, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    t!.clock.advance(STALL_AFTER_MS + 60_000);
    await tracker.sweepStalled();
    await tracker.sweepStalled();
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ wakeKind: "stalled", state: "working" });
    void ctx;
  });

  it("publishes delegation.updated so the UI can follow the task", async () => {
    const { events, tracker, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    expect(events.some((e) => e.type === "delegation.updated")).toBe(true);
  });
});
