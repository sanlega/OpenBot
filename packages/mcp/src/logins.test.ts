import { afterEach, describe, expect, it } from "vitest";
import { OPENBOT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { createMcpTestHarness, issueToken, makeBot } from "./test-helpers.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function call(
  h: NonNullable<typeof harness>,
  bot: ReturnType<typeof makeBot>,
  tool: string,
  payload: Record<string, unknown> = {},
) {
  const res = await h.app.inject({
    method: "POST",
    url: `/internal/tools/${tool}`,
    headers: { "x-openbot-session": issueToken(h, bot) },
    payload,
  });
  return res.json<Record<string, unknown>>();
}

describe("login tools", () => {
  it("are offered to every bot", () => {
    const names = OPENBOT_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_logins", "save_login", "forget_login"]));
  });

  it("save a login from a secret reference, list it without the password, and forget it", async () => {
    harness = await createMcpTestHarness();
    const h = harness;
    const bot = makeBot({ name: "Worker", slug: "worker" });
    h.ctx.repos.bots.create(bot);
    // What answering an ask_user secret field leaves in the vault.
    await h.ctx.vault.set("input.form1.password", "correct horse");

    expect(await call(h, bot, "list_logins")).toMatchObject({ allowed: true, logins: [] });

    const saved = await call(h, bot, "save_login", {
      site: "https://www.example.com/login",
      username: "me@example.com",
      password: "secret:input.form1.password",
    });
    expect(saved).toMatchObject({ allowed: true, saved: true, site: "example.com" });

    const listed = await call(h, bot, "list_logins");
    expect(listed).toMatchObject({
      allowed: true,
      logins: [{ site: "example.com", username: "me@example.com", hasPassword: true }],
    });
    expect(JSON.stringify(listed)).not.toContain("correct horse");
    expect(JSON.stringify(saved)).not.toContain("correct horse");

    expect(await call(h, bot, "forget_login", { site: "example.com" })).toMatchObject({
      allowed: true,
      removed: true,
    });
    expect(await call(h, bot, "forget_login", { site: "example.com" })).toMatchObject({
      allowed: false,
    });
  });

  it("refuse a site that is not a website address", async () => {
    harness = await createMcpTestHarness();
    const bot = makeBot({ name: "Worker", slug: "worker" });
    harness.ctx.repos.bots.create(bot);
    expect(await call(harness, bot, "save_login", { site: "nope", username: "a" })).toMatchObject({
      allowed: false,
    });
  });
});
