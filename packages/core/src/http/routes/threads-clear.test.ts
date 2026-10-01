import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { newId, type Message } from "@openbot/contracts";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

async function setup() {
  testContext = await createTestContext();
  const ctx = testContext.ctx;
  app = await buildServer(ctx);
  const bots = ["Writer", "Scout"].map((name) => {
    const botId = newId("bot");
    const res = { botId, threadId: newId("thread") };
    ctx.repos.bots.create({
      id: botId,
      slug: name.toLowerCase(),
      name,
      description: name,
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user",
      routing: { mode: "auto" },
      permissionPreset: "full",
      computer: "docker",
      connectors: [],
      limits: {},
    });
    ctx.repos.threads.create({
      id: res.threadId,
      botId,
      kind: "dm",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    for (const text of ["hello", "hi there"]) {
      const message: Message = {
        id: newId("message"),
        threadId: res.threadId,
        author: text === "hello" ? { type: "user", id: "user" } : { type: "bot", id: botId },
        text,
        attachments: [],
        hop: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        proactive: false,
        delivery: "delivered",
        pushed: false,
      };
      ctx.repos.messages.create(message);
    }
    ctx.repos.engineSessions.upsert({
      id: `ses_${name}`,
      botId,
      engine: "claude",
      sessionId: `sess-${name}`,
      at: new Date(),
    });
    return res;
  });
  const events: string[] = [];
  ctx.eventBus.subscribe((e) => {
    if (e.type === "thread.cleared") events.push(e.threadId ?? "");
  });
  return { ctx, app, bots, events };
}

describe("clearing chats", () => {
  it("clears one chat: its messages go and the bot starts a new engine session", async () => {
    const { ctx, app, bots, events } = await setup();
    const [writer, scout] = bots;
    const res = await app.inject({ method: "POST", url: `/api/threads/${writer!.threadId}/clear` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, removed: 2 });
    expect(ctx.repos.messages.list({ threadId: writer!.threadId })).toHaveLength(0);
    expect(ctx.repos.engineSessions.getForBotAndEngine(writer!.botId, "claude")).toBeUndefined();
    // The other bot is untouched.
    expect(ctx.repos.messages.list({ threadId: scout!.threadId })).toHaveLength(2);
    expect(ctx.repos.engineSessions.getForBotAndEngine(scout!.botId, "claude")).toBeDefined();
    expect(events).toEqual([writer!.threadId]);
    // The bot itself stays.
    expect(ctx.repos.bots.getById(writer!.botId)?.archivedAt).toBeUndefined();
  });

  it("clears every chat at once and keeps the bots", async () => {
    const { ctx, app, bots } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/threads/clear-all" });
    expect(res.json()).toMatchObject({ ok: true, removed: 4, threads: 2 });
    for (const b of bots) {
      expect(ctx.repos.messages.list({ threadId: b.threadId })).toHaveLength(0);
      expect(ctx.repos.bots.getById(b.botId)).toBeDefined();
    }
  });

  it("refuses while the bot is working", async () => {
    const { ctx, app, bots } = await setup();
    ctx.repos.turns.create({
      id: newId("turn"),
      botId: bots[0]!.botId,
      chainId: "chn_1",
      engine: "claude",
      model: "sonnet",
      status: "running",
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const one = await app.inject({
      method: "POST",
      url: `/api/threads/${bots[0]!.threadId}/clear`,
    });
    expect(one.statusCode).toBe(409);
    const all = await app.inject({ method: "POST", url: "/api/threads/clear-all" });
    expect(all.statusCode).toBe(409);
    expect(all.json().reason).toContain("Writer");
    expect(ctx.repos.messages.list({ threadId: bots[1]!.threadId })).toHaveLength(2);
  });
});
