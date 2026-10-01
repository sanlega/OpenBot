import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { createTestContext, type TestContext } from "../test-helpers.js";
import { loadOrCreateLocalOwnerKey, LOCAL_OWNER_KEY_HEADER } from "../local-owner-key.js";

const KEY = "ab".repeat(32);

let t: TestContext | undefined;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  await t?.cleanup();
  app = undefined;
  t = undefined;
});

describe("the local owner key (D-036)", () => {
  it("loopback alone is not the owner; the key is, by header or on the event stream", async () => {
    t = await createTestContext({ localOwnerKey: KEY });
    app = await buildServer(t.ctx);
    const get = (headers: Record<string, string> = {}, url = "/api/bots") =>
      app!.inject({ method: "GET", url, headers });

    expect((await get()).statusCode).toBe(401);
    expect((await get({ [LOCAL_OWNER_KEY_HEADER]: "cd".repeat(32) })).statusCode).toBe(401);
    expect((await get({ [LOCAL_OWNER_KEY_HEADER]: KEY.slice(1) })).statusCode).toBe(401);
    expect((await get({ [LOCAL_OWNER_KEY_HEADER]: KEY })).statusCode).toBe(200);
    // The event stream can't set headers in a browser: `?key=` works the same.
    expect((await get({}, `/api/bots?key=${KEY}`)).statusCode).toBe(200);
    // The key doesn't help a request relayed by a proxy, or one addressed to another host name.
    expect(
      (await get({ [LOCAL_OWNER_KEY_HEADER]: KEY, "x-forwarded-for": "203.0.113.9" })).statusCode,
    ).toBe(401);
    expect(
      (await get({ [LOCAL_OWNER_KEY_HEADER]: KEY, host: "evil.example:4577" })).statusCode,
    ).toBe(401);
  });

  it("is made once per install, 64 hex characters, and kept", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbot-key-"));
    try {
      const first = await loadOrCreateLocalOwnerKey(home);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(await loadOrCreateLocalOwnerKey(home)).toBe(first);
      expect((await readFile(join(home, "local-owner.key"), "utf8")).trim()).toBe(first);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
