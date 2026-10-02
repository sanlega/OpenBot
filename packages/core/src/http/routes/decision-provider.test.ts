import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { newId } from "@openbot/contracts";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";
import { LOCAL_DECISIONS_KEY } from "./decision-provider.js";

let t: TestContext | undefined;
let app: FastifyInstance | undefined;
let fake: Server | undefined;
afterEach(async () => {
  await app?.close();
  await t?.cleanup();
  await new Promise((r) => (fake ? fake.close(r) : r(undefined)));
  app = undefined;
  t = undefined;
  fake = undefined;
});

/** A Jev-compatible server stub: answers the probe, records what it was sent. */
async function fakeDecisionServer(reply: (body: Record<string, unknown>) => unknown) {
  const seen: Array<{ body: Record<string, unknown>; auth?: string }> = [];
  fake = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      seen.push({ body, auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(body)));
    });
  });
  await new Promise<void>((r) => fake!.listen(0, "127.0.0.1", r));
  const port = (fake.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen };
}

describe("Settings > Jev: the decision provider (D-037)", () => {
  it("needs a local server before switching to it, and '' clears an address", async () => {
    t = await createTestContext();
    app = await buildServer(t.ctx);
    const patch = (decisions: unknown) =>
      app!.inject({ method: "PATCH", url: "/api/settings", payload: { decisions } });

    expect((await patch({ mode: "hybrid" })).statusCode).toBe(400);
    const ok = await patch({ mode: "hybrid", localUrl: "http://127.0.0.1:8000" });
    expect(ok.json().settings.decisions).toMatchObject({
      mode: "hybrid",
      localUrl: "http://127.0.0.1:8000",
      keepRequests: true,
    });
    expect((await patch({ localUrl: "" })).statusCode).toBe(400); // still hybrid
    const back = await patch({ mode: "jev", localUrl: "" });
    expect(back.json().settings.decisions.localUrl).toBeUndefined();
    expect((await patch({ localUrl: "ftp://x" })).statusCode).toBe(400);
    expect((await patch({ localBands: { autoMin: 0.5, confirmMin: 0.9 } })).statusCode).toBe(400);
  });

  it("turning 'keep what decisions saw' off forgets what was kept", async () => {
    t = await createTestContext();
    app = await buildServer(t.ctx);
    t.ctx.repos.decisions.create({
      id: newId("decision"),
      purpose: "risk",
      provider: "jev",
      model: "jev",
      stateHash: "h",
      request: { state: { a: 1 }, questions: {} },
      answers: {},
      band: "auto",
      outcome: "allow",
      createdAt: new Date().toISOString(),
    });
    expect(t.ctx.repos.decisions.listWithRequests()).toHaveLength(1);
    // The audit list never carries what a decision saw.
    const listed = (await app.inject({ method: "GET", url: "/api/decisions" })).json();
    expect(listed.decisions[0]).not.toHaveProperty("request");

    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { decisions: { keepRequests: false } },
    });
    expect(t.ctx.repos.decisions.listWithRequests()).toHaveLength(0);
  });

  it("checks a server: which model answered, how fast, and whether it got the probe right", async () => {
    t = await createTestContext();
    app = await buildServer(t.ctx);
    const server = await fakeDecisionServer(() => ({
      model: "laya-multilingual",
      answers: { sky: { type: "noul", noul: 0.97 } },
    }));
    await app.inject({ method: "PUT", url: "/api/decisions/local-key", payload: { key: "k-123" } });
    expect(await t.ctx.vault.get(LOCAL_DECISIONS_KEY)).toBe("k-123");

    const res = (
      await app.inject({
        method: "POST",
        url: "/api/decisions/check",
        payload: { url: server.url },
      })
    ).json();
    expect(res).toMatchObject({ ok: true, model: "laya-multilingual", correct: true });
    expect(server.seen[0]!.auth).toBe("Bearer k-123");

    const vision = (
      await app.inject({
        method: "POST",
        url: "/api/decisions/check",
        payload: { url: server.url, kind: "vision" },
      })
    ).json();
    expect(vision.ok).toBe(true);
    expect(String((server.seen[1]!.body.images as string[])[0])).toMatch(
      /^data:image\/jpeg;base64,/,
    );

    // The key can be removed.
    await app.inject({ method: "PUT", url: "/api/decisions/local-key", payload: { key: "" } });
    expect(await t.ctx.vault.get(LOCAL_DECISIONS_KEY)).toBeUndefined();
  });

  it("says plainly when nothing answers, or the answer isn't a decision", async () => {
    t = await createTestContext();
    app = await buildServer(t.ctx);
    const down = (
      await app.inject({
        method: "POST",
        url: "/api/decisions/check",
        payload: { url: "http://127.0.0.1:9" },
      })
    ).json();
    expect(down).toMatchObject({ ok: false });
    expect(down.reason).toMatch(/Nothing answers/);

    const server = await fakeDecisionServer(() => ({ hello: "world" }));
    const odd = (
      await app.inject({
        method: "POST",
        url: "/api/decisions/check",
        payload: { url: server.url },
      })
    ).json();
    expect(odd).toMatchObject({ ok: false });
    expect(odd.reason).toMatch(/not like a Jev-compatible/);
  });
});
