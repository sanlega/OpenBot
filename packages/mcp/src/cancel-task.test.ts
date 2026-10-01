import { afterEach, describe, expect, it } from "vitest";
import { newId } from "@openbot/contracts";
import { delegationsOf } from "@openbot/core";
import { createMcpTestHarness, issueToken, makeBot } from "./test-helpers.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;
afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

describe("cancel_task (L1)", () => {
  it("lets the requester cancel its task, and nobody else", async () => {
    harness = await createMcpTestHarness();
    const h = harness;
    const boss = makeBot({ name: "Boss", slug: "boss" });
    const worker = makeBot({ name: "Worker", slug: "worker" });
    const stranger = makeBot({ name: "Stranger", slug: "stranger" });
    for (const b of [boss, worker, stranger]) {
      h.ctx.repos.bots.create(b);
      if (!h.ctx.repos.threads.getByBotId(b.id)) {
        h.ctx.repos.threads.create({
          id: newId("thread"),
          botId: b.id,
          kind: "dm",
          createdAt: h.ctx.clock.now().toISOString(),
        });
      }
    }
    h.ctx.mailbox = { stopBot: async () => ({ ok: true }) } as never;
    const opened = delegationsOf(h.ctx).open({
      requesterBotId: boss.id,
      assigneeBotId: worker.id,
      chainId: "chn_1",
      text: "Build the landing page",
    });
    if (!opened.ok) throw new Error(opened.reason);
    const call = (bot: typeof boss, payload: Record<string, unknown>) =>
      h.app
        .inject({
          method: "POST",
          url: "/internal/tools/cancel_task",
          headers: { "x-openbot-session": issueToken(h, bot) },
          payload,
        })
        .then((r) => r.json<{ allowed: boolean; reason?: string; cancelled?: unknown[] }>());

    expect(await call(stranger, { task_id: opened.delegation.id })).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/only the bot that handed out/),
    });
    const done = await call(boss, { bot: "worker", reason: "no longer needed" });
    expect(done).toMatchObject({ allowed: true });
    expect(done.cancelled).toHaveLength(1);
    expect(delegationsOf(h.ctx).get(opened.delegation.id)?.statusMessage).toMatch(
      /cancelled by Boss \(no longer needed\)/,
    );
  });
});
