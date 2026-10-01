import { afterEach, describe, expect, it } from "vitest";
import { memoryPromptBlock } from "@openbot/core";
import { createMcpTestHarness, issueToken, makeBot } from "./test-helpers.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;
afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function setup() {
  harness = await createMcpTestHarness();
  const h = harness;
  const writer = makeBot({ name: "Writer", slug: "writer" });
  const other = makeBot({ name: "Other", slug: "other" });
  h.ctx.repos.bots.create(writer);
  h.ctx.repos.bots.create(other);
  const call = <T = Record<string, unknown>>(
    bot: typeof writer,
    tool: string,
    payload: Record<string, unknown>,
  ) =>
    h.app
      .inject({
        method: "POST",
        url: `/internal/tools/${tool}`,
        headers: { "x-openbot-session": issueToken(h, bot) },
        payload,
      })
      .then((r) => r.json<{ allowed: boolean; reason?: string } & T>());
  return { h, writer, other, call };
}

describe("memory tools (C5)", () => {
  it("remembers across bots by scope and shows it in the prompt with date and source", async () => {
    const { h, writer, other, call } = await setup();
    expect(await call(writer, "remember", { fact: "Reports go in a table" })).toMatchObject({
      allowed: true,
      scope: "bot",
      tier: "profile",
    });
    const shared = await call(writer, "remember", {
      fact: "The user is called Alex",
      scope: "user",
    });
    expect(shared).toMatchObject({ allowed: true, tell_user: expect.stringMatching(/every bot/) });

    const mine = memoryPromptBlock(h.ctx, writer);
    expect(mine).toMatch(/- \(learned \d{4}-\d{2}-\d{2}\) \[you\] Reports go in a table/);
    expect(mine).toMatch(/\[about the user\] The user is called Alex/);
    const theirs = memoryPromptBlock(h.ctx, other);
    expect(theirs).toContain("The user is called Alex");
    expect(theirs).not.toContain("Reports go in a table");
  });

  it("does not save secrets or duplicates, and forgets by exact text", async () => {
    const { writer, call } = await setup();
    const secret = await call(writer, "remember", { fact: "api key: sk-abcdefghijklmnopqrstu" });
    expect(secret).toMatchObject({ allowed: false });
    expect(secret.reason).toMatch(/vault/);
    await call(writer, "remember", { fact: "Deploys happen on Fridays", tier: "note" });
    expect(await call(writer, "remember", { fact: "deploys happen on  fridays" })).toMatchObject({
      note: "you already knew this",
    });
    const found = await call<{ facts: Array<{ fact: string }> }>(writer, "recall", {
      query: "friday deploys",
    });
    expect(found.facts.map((f) => f.fact)).toEqual(["Deploys happen on Fridays"]);
    expect(await call(writer, "forget", { fact: "Deploys happen on Fridays" })).toMatchObject({
      allowed: true,
    });
    const after = await call<{ facts: unknown[] }>(writer, "recall", { query: "deploys" });
    expect(after.facts).toEqual([]);
  });

  it("an empty memory still explains how to use it", async () => {
    const { h, writer } = await setup();
    expect(memoryPromptBlock(h.ctx, writer)).toMatch(/MEMORY[\s\S]*no saved memories yet/);
  });
});
