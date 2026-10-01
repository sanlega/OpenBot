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
    tracker.bindTurn(worker.id, d.id);
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
    tracker.bindTurn(worker.id, d.id);
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

  it("routes only the turn that belongs to a delegation: the user's own chat with the worker is untouched", async () => {
    const { worker, tracker, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    // An open task exists, but the running turn is a plain one (nothing bound).
    expect(tracker.current(worker.id)).toBeUndefined();
    expect(await tracker.report(worker.id, "blocker", "hello user")).toBeUndefined();
    expect(await tracker.needsAnswer(worker.id, "x")).toBeUndefined();
    tracker.bindTurn(worker.id, d.id);
    expect(tracker.current(worker.id)?.id).toBe(d.id);
    tracker.unbindTurn(worker.id, d.id);
    expect(tracker.current(worker.id)).toBeUndefined();
  });

  it("a follow-up sent while the worker is still working settles only when its turn ends too", async () => {
    const { tracker, woken, open } = await setup();
    const d = open("first");
    tracker.expectTurn(d.id);
    await tracker.started(d.id, "codex");
    open("follow-up");
    tracker.expectTurn(d.id);

    await tracker.turnEnded(d.id, { status: "completed", text: "answer to first" });
    expect(woken).toHaveLength(0);
    expect(tracker.get(d.id)!.state).toBe("working");

    await tracker.turnEnded(d.id, { status: "completed", text: "answer to the follow-up" });
    expect(woken).toHaveLength(1);
    expect(woken[0]!.result).toBe("answer to the follow-up");
  });

  it("a form and an approval pending together: back to work only when both are answered", async () => {
    const { worker, tracker, open } = await setup();
    const d = open();
    tracker.bindTurn(worker.id, d.id);
    await tracker.needsAnswer(worker.id, "form");
    await tracker.needsAnswer(worker.id, "card");
    await tracker.answered(worker.id);
    expect(tracker.get(d.id)!.state).toBe("input_required");
    await tracker.answered(worker.id);
    expect(tracker.get(d.id)!.state).toBe("working");
  });

  it("keeps the worker's own result when the turn returned no closing text", async () => {
    const { worker, tracker, woken, open } = await setup();
    const d = open();
    await tracker.started(d.id, "codex");
    tracker.bindTurn(worker.id, d.id);
    await tracker.report(worker.id, "result", "The real findings");
    await tracker.turnEnded(d.id, {
      status: "completed",
      text: "Finished 2 tool calls but didn't return a summary",
      synthesized: true,
    });
    expect(woken[0]!.result).toBe("The real findings");
  });

  it("a task the user stopped is not sold to the requester as a failure to retry", async () => {
    const { tracker, woken, open } = await setup();
    const d = open();
    await tracker.turnEnded(d.id, { status: "refused", reason: "stopped" });
    expect(woken[0]).toMatchObject({ state: "interrupted", wakeKind: "stopped" });
  });

  it("a worker's onward delegation reports in the user's conversation, not the worker's", async () => {
    const { ctx, chief, worker, tracker, open } = await setup();
    const parent = open();
    const helper = bot("Helper");
    ctx.repos.bots.create(helper);
    ctx.repos.threads.create({
      id: newId("thread"),
      botId: helper.id,
      kind: "dm",
      createdAt: new Date().toISOString(),
    });
    tracker.bindTurn(worker.id, parent.id);
    const child = open("sub-task", worker, helper);
    expect(child.ownerThreadId).toBe(parent.ownerThreadId);
    expect(child.ownerThreadId).toBe(ctx.repos.threads.getByBotId(chief.id)!.id);
  });

  it("bounds the fail-and-retry cycle per requester and worker pair", async () => {
    const { ctx, chief, worker, tracker, open } = await setup();
    for (let i = 0; i < 6; i++) {
      const d = open(`try ${i}`);
      await tracker.turnEnded(d.id, { status: "failed", reason: "engine down" });
    }
    const again = tracker.open({
      requesterBotId: chief.id,
      assigneeBotId: worker.id,
      chainId: "chn_1",
      text: "try again",
    });
    expect(again.ok).toBe(false);
    void ctx;
  });

  it("after a restart a task waiting on a permission card parked in a lost turn is interrupted", async () => {
    const { worker, tracker, woken, open } = await setup();
    const d = open();
    tracker.bindTurn(worker.id, d.id);
    await tracker.started(d.id, "codex");
    await tracker.needsAnswer(worker.id, "waiting for the user's approval: shell");
    await tracker.recover();
    expect(tracker.get(d.id)!.state).toBe("interrupted");
    expect(woken).toHaveLength(1);
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

    await t?.cleanup();
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

describe("cancel and depth (L1, L2)", () => {
  function addBot(ctx: TestContext["ctx"], name: string): Bot {
    const b = bot(name);
    ctx.repos.bots.create(b);
    ctx.repos.threads.create({
      id: newId("thread"),
      botId: b.id,
      kind: "dm",
      createdAt: t!.clock.now().toISOString(),
    });
    return b;
  }
  function mailboxSpy(ctx: TestContext["ctx"]) {
    const cancelled: Array<[string, string]> = [];
    ctx.mailbox = {
      cancelTask: async (botId: string, taskId: string) => {
        cancelled.push([botId, taskId]);
      },
    } as never;
    return cancelled;
  }

  it("cancels the task and the tasks handed out for it, and only their work", async () => {
    const { ctx, chief, worker, tracker, woken, open } = await setup();
    const helper = addBot(ctx, "Helper");
    const other = addBot(ctx, "Other");
    // Work the worker handed out before it had this task: unrelated, it stays.
    const unrelated = open("Book the room", worker, other);
    const parent = open("Research and write the report");
    // The worker's running turn is for the parent: what it hands out is the parent's helper work.
    tracker.bindTurn(worker.id, parent.id);
    const child = open("Collect the numbers", worker, helper);
    tracker.unbindTurn(worker.id, parent.id);
    expect(child.parentId).toBe(parent.id);
    expect(unrelated.parentId).toBeUndefined();
    const stopped = mailboxSpy(ctx);

    const cancelled = await tracker.cancel(parent.id, { name: "Chief", botId: chief.id });
    expect(cancelled.map((d) => d.id)).toEqual([child.id, parent.id]);
    expect(tracker.get(parent.id)).toMatchObject({
      state: "interrupted",
      statusMessage: "cancelled by Chief",
      wakePending: false,
    });
    expect(tracker.get(unrelated.id)?.state).toBe("submitted");
    // Only each task's own turns stop.
    expect(stopped).toEqual([
      [helper.id, child.id],
      [worker.id, parent.id],
    ]);
    // The Chief cancelled its own task: nobody is woken. Nor is the worker about the child: its
    // own task is being cancelled too, and a wake would restart that work.
    expect(woken).toEqual([]);
    expect(await tracker.cancel(parent.id, { name: "Chief", botId: chief.id })).toEqual([]);
  });

  it("a wake turn's hand-off belongs to the bot's task; a direct chat starts its own chain", async () => {
    const { ctx, tracker, open, worker } = await setup();
    const helper = addBot(ctx, "Helper2");
    const parent = open("Write the launch post");
    // A wake turn about that task (a helper reported back): what it hands out belongs to it.
    tracker.setContext(worker.id, parent.id);
    const child = open("Find three quotes", worker, helper);
    tracker.setContext(worker.id, undefined);
    expect(child).toMatchObject({ parentId: parent.id, depth: 2 });
    // The user talking to the worker directly: unrelated work, in the worker's own chat.
    const other = addBot(ctx, "Other2");
    const direct = open("Book a table", worker, other);
    expect(direct.parentId).toBeUndefined();
    expect(direct.depth).toBe(1);
    expect(direct.ownerThreadId).toBe(ctx.repos.threads.getByBotId(worker.id)!.id);
  });

  it("tells the bot that asked when the user cancels its task", async () => {
    const { ctx, tracker, woken, open } = await setup();
    mailboxSpy(ctx);
    const task = open("Deploy");
    await tracker.cancel(task.id, { name: "you" });
    expect(woken.map((d) => d.id)).toEqual([task.id]);
    const card = ctx.repos.messages
      .list({ threadId: task.ownerThreadId })
      .find((m) => m.text.includes("stopped working on"));
    expect(card?.text).toMatch(/it was cancelled by you/);
  });

  it("refuses a hand-off deeper than the limit, counting from the task being worked on", async () => {
    const { ctx, tracker, open, worker } = await setup();
    const [b, c, d] = ["B", "C", "D"].map((n) => addBot(ctx, n));
    const l1 = open("level 1");
    tracker.bindTurn(worker.id, l1.id);
    const l2 = open("level 2", worker, b);
    tracker.bindTurn(b!.id, l2.id);
    const l3 = open("level 3", b, c);
    expect([l1.depth, l2.depth, l3.depth]).toEqual([1, 2, 3]);
    tracker.bindTurn(c!.id, l3.id);
    const r = tracker.open({
      requesterBotId: c!.id,
      assigneeBotId: d!.id,
      chainId: "chn_1",
      text: "level 4",
    });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toMatch(/do it yourself/);
    // In a wake turn about that task: still too deep.
    tracker.unbindTurn(c!.id, l3.id);
    tracker.setContext(c!.id, l3.id);
    expect(
      tracker.open({
        requesterBotId: c!.id,
        assigneeBotId: d!.id,
        chainId: "chn_2",
        text: "again",
      }),
    ).toMatchObject({ ok: false });
    tracker.setContext(c!.id, undefined);
    // A bot with no task of its own starts a new chain.
    const fresh = tracker.open({
      requesterBotId: d!.id,
      assigneeBotId: c!.id,
      chainId: "chn_3",
      text: "fresh",
    });
    expect(fresh).toMatchObject({ ok: true, delegation: { depth: 1 } });
  });
});
