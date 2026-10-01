import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CustomEngineSpec } from "../../context.js";
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
  let saved: CustomEngineSpec[] = [];
  ctx.engineStatuses = {
    claude: { installed: true, login: { ok: true }, apiKey: { ok: false } },
    cursor: { installed: true, login: { ok: false }, apiKey: { ok: false } },
  };
  ctx.engineDescriptors = {
    cursor: {
      id: "cursor",
      label: "Cursor",
      kind: "acp",
      loginCommand: "cursor-agent login",
      capabilities: { resume: true, steer: false },
    },
    gemini: {
      id: "gemini",
      label: "Gemini CLI",
      kind: "acp",
      capabilities: { resume: true, steer: false },
    },
  };
  ctx.availableEngines = ["claude"];
  ctx.customEngines = {
    list: () => saved,
    save: async (engines) => {
      saved = engines;
    },
  };
  app = await buildServer(ctx);
  return { app, saved: () => saved };
}

describe("engine routes", () => {
  it("lists every known engine with its status and descriptor", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/engines" });
    const engines = (res.json() as { engines: Array<Record<string, unknown>> }).engines;
    expect(engines.find((e) => e.id === "cursor")).toMatchObject({
      installed: true,
      available: false,
      login: { ok: false },
      descriptor: { loginCommand: "cursor-agent login" },
    });
    // Known but not detected at all: shown as not installed.
    expect(engines.find((e) => e.id === "gemini")).toMatchObject({ installed: false });
    expect(engines.find((e) => e.id === "claude")).toMatchObject({ available: true });
  });

  it("detects the engines again on request (P1)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/engines/redetect" });
    expect(res.statusCode).toBe(501);
    testContext!.ctx.redetectEngines = async () => {
      testContext!.ctx.availableEngines = ["claude", "cursor"];
      return ["claude", "cursor"];
    };
    const again = await app.inject({ method: "POST", url: "/api/engines/redetect" });
    expect(again.json()).toEqual({ available: ["claude", "cursor"] });
    const listed = await app.inject({ method: "GET", url: "/api/engines" });
    const engines = (listed.json() as { engines: Array<Record<string, unknown>> }).engines;
    expect(engines.find((e) => e.id === "cursor")).toMatchObject({ available: true });
  });

  it("wires a saved custom agent at once when it can detect again", async () => {
    const { app } = await setup();
    testContext!.ctx.redetectEngines = async () => ["claude", "acp-goose"];
    const res = await app.inject({
      method: "PUT",
      url: "/api/engines/custom",
      payload: { engines: [{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }] },
    });
    expect(res.json()).toMatchObject({
      restartRequired: false,
      available: ["claude", "acp-goose"],
    });
  });

  it("saves custom ACP engines and asks for a restart", async () => {
    const { app, saved } = await setup();
    const res = await app.inject({
      method: "PUT",
      url: "/api/engines/custom",
      payload: { engines: [{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ restartRequired: true });
    expect(saved()).toEqual([{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }]);
    const listed = await app.inject({ method: "GET", url: "/api/engines/custom" });
    expect(listed.json()).toEqual({ engines: saved() });
  });

  it("only the owner changes engines; another site's page can't act as the local owner", async () => {
    const { app } = await setup();
    let ran = 0;
    testContext!.ctx.redetectEngines = async () => {
      ran += 1;
      return [];
    };
    const payload = { engines: [{ slug: "x", label: "X", command: "x", args: [] }] };
    // Not on this computer and no device token.
    const remote = { remoteAddress: "192.168.1.50" };
    expect(
      (await app.inject({ method: "PUT", url: "/api/engines/custom", payload, ...remote }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api/engines/redetect", ...remote })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/engines", ...remote })).statusCode).toBe(
      401,
    );
    // A page from another site, through the owner's own browser.
    const foreign = { origin: "https://evil.example", host: "127.0.0.1:4577" };
    expect(
      (await app.inject({ method: "POST", url: "/api/engines/redetect", headers: foreign }))
        .statusCode,
    ).toBe(403);
    expect(ran).toBe(0);
    // OpenBot's own page.
    const own = { origin: "http://127.0.0.1:4577", host: "127.0.0.1:4577" };
    expect(
      (await app.inject({ method: "POST", url: "/api/engines/redetect", headers: own })).statusCode,
    ).toBe(200);
    expect(ran).toBe(1);

    // Relayed by a proxy to 127.0.0.1 (Tailscale serve, a Cloudflare tunnel): not the owner.
    for (const relayed of [
      { "cf-connecting-ip": "203.0.113.9" },
      { "tailscale-user-login": "someone@example.com", host: "box.tailnet.ts.net" },
      { "x-forwarded-for": "203.0.113.9" },
      { "tailscale-funnel-request": "?1" },
      { via: "1.1 proxy" },
      { "x-forwarded-proto": "https" },
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/engines/custom",
        payload,
        headers: relayed,
      });
      expect(res.statusCode, JSON.stringify(relayed)).toBe(401);
    }
    // A page whose DNS was rebound to 127.0.0.1 (its own host name, matching Origin).
    const rebound = { host: "evil.example:4577", origin: "http://evil.example:4577" };
    expect(
      (await app.inject({ method: "POST", url: "/api/engines/redetect", headers: rebound }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/engines", headers: rebound })).statusCode,
    ).toBe(401);
    expect(ran).toBe(1);
  });

  it("never runs a custom agent from a network share", async () => {
    const { app } = await setup();
    for (const command of [
      "\\\\host\\share\\agent.exe",
      "//host/share/agent",
      "\\/host/share/agent",
      "/\\host\\share\\agent",
      "\\\\?\\UNC\\host\\share\\a.exe",
      "https://x/agent",
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/engines/custom",
        payload: { engines: [{ slug: "x", label: "X", command, args: [] }] },
      });
      expect(res.statusCode, command).toBe(400);
    }
  });

  it("rejects invalid custom engines", async () => {
    const { app } = await setup();
    for (const engines of [
      [{ slug: "Bad Slug", label: "x", command: "y", args: [] }],
      [{ slug: "ok", label: "", command: "y", args: [] }],
      [{ slug: "ok", label: "x", command: "", args: [] }],
      [{ slug: "ok", label: "x", command: "y", args: [1] }],
      [
        { slug: "ok", label: "x", command: "y", args: [] },
        { slug: "ok", label: "z", command: "y", args: [] },
      ],
      "nope",
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/engines/custom",
        payload: { engines },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
