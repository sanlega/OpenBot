import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DecisionService } from "@openbot/contracts";
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

describe("POST /api/setup/validate (typesafe)", () => {
  it("runs the registered validator, so a valid key is saved and not only probed", async () => {
    testContext = await createTestContext();
    const ctx = testContext.ctx;
    ctx.decisionService = {
      validateKey: async () => ({ ok: true }),
    } as unknown as DecisionService;
    ctx.validators.typesafe = async (value) => {
      if (value) await ctx.vault.set("typesafe.apiKey", value);
      return { ok: true };
    };
    app = await buildServer(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/validate",
      payload: { kind: "typesafe", value: "ts_test_key" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: { ok: true }, setup: { typesafe: { ok: true } } });
    expect(await ctx.vault.get("typesafe.apiKey")).toBe("ts_test_key");
  });

  it("falls back to probing the key when no validator is registered", async () => {
    testContext = await createTestContext();
    const ctx = testContext.ctx;
    ctx.decisionService = {
      validateKey: async (key: string) => ({ ok: key === "good" }),
    } as unknown as DecisionService;
    app = await buildServer(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/validate",
      payload: { kind: "typesafe", value: "bad" },
    });

    expect(res.json()).toMatchObject({ result: { ok: false } });
  });
});

describe("defaults for new bots (M1)", () => {
  it("are saved in Settings and used when a bot is created without choosing", async () => {
    testContext = await createTestContext();
    app = await buildServer(testContext.ctx);
    const plain = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Before" },
    });
    expect(plain.json().bot).toMatchObject({
      routing: { mode: "auto" },
      permissionPreset: "full",
      computer: "docker",
    });

    const saved = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: {
        botDefaults: {
          routing: { mode: "pinned", engine: "codex" },
          permissionPreset: "workspace_write",
          computer: "none",
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.botDefaults).toMatchObject({
      permissionPreset: "workspace_write",
    });

    const after = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "After" },
    });
    expect(after.json().bot).toMatchObject({
      routing: { mode: "pinned", engine: "codex" },
      permissionPreset: "workspace_write",
      computer: "none",
    });
    // What the creator chose still wins.
    const chosen = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Chosen", computer: "docker", permissionPreset: "full" },
    });
    expect(chosen.json().bot).toMatchObject({ computer: "docker", permissionPreset: "full" });
  });
});
