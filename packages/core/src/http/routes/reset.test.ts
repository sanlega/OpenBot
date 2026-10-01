import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { newId } from "@openbot/contracts";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";

let t: TestContext | undefined;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  await t?.cleanup();
  app = undefined;
  t = undefined;
});

describe("POST /api/reset (M2)", () => {
  it("starts over: keeps the Chief, keys and devices; removes bots, chats and memories", async () => {
    t = await createTestContext();
    const ctx = t.ctx;
    app = await buildServer(ctx);
    const chief = (
      await app.inject({
        method: "POST",
        url: "/api/bots",
        payload: { name: "Chief", isChiefOfStaff: true },
      })
    ).json();
    const worker = (
      await app.inject({ method: "POST", url: "/api/bots", payload: { name: "Worker" } })
    ).json();
    for (const who of [chief, worker]) {
      ctx.repos.messages.create({
        id: newId("message"),
        threadId: who.thread.id,
        author: { type: "user" },
        text: "hello",
        attachments: [],
        hop: 0,
        createdAt: ctx.clock.now().toISOString(),
        proactive: false,
        delivery: "delivered",
        pushed: false,
      });
    }
    ctx.repos.memories.create({
      id: newId("memory"),
      scope: "user",
      botId: worker.bot.id,
      tier: "profile",
      content: "The user likes tables",
      createdAt: ctx.clock.now().toISOString(),
      updatedAt: ctx.clock.now().toISOString(),
    });
    await ctx.vault.set("anthropic.apiKey", "kept-key");

    const refused = await app.inject({
      method: "POST",
      url: "/api/reset",
      payload: { confirm: "yes" },
    });
    expect(refused.statusCode).toBe(400);
    expect(ctx.repos.bots.getById(worker.bot.id)).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: "/api/reset",
      payload: { confirm: "RESET" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, bots: 1, messages: 2, memories: 1 });
    expect(ctx.repos.bots.getById(worker.bot.id)).toBeUndefined();
    expect(ctx.repos.bots.getById(chief.bot.id)).toBeDefined();
    expect(ctx.repos.threads.getByBotId(chief.bot.id)).toBeDefined();
    expect(ctx.repos.messages.list({ threadId: chief.thread.id })).toEqual([]);
    expect(ctx.repos.memories.visibleTo()).toEqual([]);
    expect(await ctx.vault.get("anthropic.apiKey")).toBe("kept-key");
  });
});
