import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SharedCookieJar, type BrowserCookie, type CookieAccess } from "./cookie-jar.js";

/** Browsers keyed by debug port, each a cookie store. */
function fakeBrowsers(ports: number[]) {
  const stores = new Map<number, Map<string, BrowserCookie>>(ports.map((p) => [p, new Map()]));
  const key = (c: Pick<BrowserCookie, "name" | "domain" | "path">) =>
    `${c.domain}|${c.path}|${c.name}`;
  const access: CookieAccess = {
    async getAll(port) {
      const s = stores.get(port);
      if (!s) throw new Error("gone");
      return [...s.values()].map((c) => ({ ...c }));
    },
    async set(port, cookies) {
      for (const c of cookies) stores.get(port)!.set(key(c), { ...c });
    },
    async remove(port, cookies) {
      for (const c of cookies) stores.get(port)!.delete(key(c));
    },
  };
  const login = (port: number, value = "token-1", name = "session", domain = ".example.com") =>
    stores.get(port)!.set(key({ name, domain, path: "/" }), {
      name,
      value,
      domain,
      path: "/",
      expires: 4_000_000_000,
      secure: true,
      httpOnly: true,
    });
  const logout = (port: number, name = "session", domain = ".example.com") =>
    stores.get(port)!.delete(key({ name, domain, path: "/" }));
  const value = (port: number, name = "session") =>
    [...stores.get(port)!.values()].find((c) => c.name === name)?.value;
  return { access, stores, login, logout, value };
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("SharedCookieJar", () => {
  it("a sign-in on one bot's screen reaches another bot's screen", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    await jar.sync(9001, [9001, 9002]);
    await jar.sync(9002, [9001, 9002]);
    b.login(9001);
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("token-1");
  });

  it("a sign-out on one screen signs the other screens out too", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001);
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("token-1");
    await jar.sync(9001, [9001, 9002]);
    b.logout(9002);
    await jar.sync(9001, [9001, 9002]);
    expect(b.value(9001)).toBeUndefined();
  });

  it("a refreshed session token wins over the old copy", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001, "old");
    await jar.sync(9002, [9001, 9002]);
    await jar.sync(9001, [9001, 9002]);
    b.login(9002, "new");
    await jar.sync(9001, [9001, 9002]);
    expect(b.value(9001)).toBe("new");
  });

  it("a browser seen for the first time cannot undo newer state with its stale profile", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001, "fresh");
    await jar.sync(9001, [9001]);
    b.login(9002, "stale");
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("fresh");
    expect(b.value(9001)).toBe("fresh");
  });

  it("keeps sign-ins across a container restart through its saved file", async () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-jar-"));
    const file = join(dir, "cookies.json");
    const b = fakeBrowsers([9001]);
    const jar = new SharedCookieJar(b.access, file);
    b.login(9001);
    await jar.sync(9001, [9001]);
    jar.flush();

    const after = fakeBrowsers([9005]);
    const restarted = new SharedCookieJar(after.access, file);
    await restarted.sync(9005, [9005]);
    expect(after.value(9005)).toBe("token-1");
  });

  it("does not hand out expired cookies, and a browser that is gone is skipped", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access, undefined, () => 5_000_000_000);
    b.login(9001);
    await jar.sync(9002, [9001, 9002, 9999]);
    expect(b.value(9002)).toBeUndefined();
  });
});

/** A Chrome-like store: partitioned cookies are distinct, `url` sets a host-only cookie. */
function chromeLike(ports: number[], rejectNames: string[] = []) {
  const stores = new Map<number, BrowserCookie[]>(ports.map((p) => [p, []]));
  const same = (a: BrowserCookie, b: BrowserCookie) =>
    a.name === b.name &&
    a.domain === b.domain &&
    a.path === b.path &&
    JSON.stringify(a.partitionKey ?? null) === JSON.stringify(b.partitionKey ?? null);
  const calls: number[] = [];
  const access: CookieAccess = {
    async getAll(port) {
      return stores.get(port)!.map((c) => ({ ...c }));
    },
    async set(port, cookies) {
      calls.push(cookies.length);
      if (cookies.some((c) => rejectNames.includes(c.name)))
        throw new Error("Invalid cookie fields");
      for (const raw of cookies) {
        const c = { ...raw };
        if (typeof c.url === "string") {
          c.domain = new URL(c.url).hostname;
          delete c.url;
        }
        const list = stores.get(port)!.filter((x) => !same(x, c));
        stores.set(port, [...list, c]);
      }
    },
    async remove(port, cookies) {
      stores.set(
        port,
        stores
          .get(port)!
          .filter((x) => !cookies.some((c) => c.name === x.name && c.domain === x.domain)),
      );
    },
  };
  const put = (port: number, cookie: Partial<BrowserCookie> & { name: string }) =>
    stores.get(port)!.push({
      value: "v",
      domain: ".example.com",
      path: "/",
      secure: true,
      expires: 4_000_000_000,
      ...cookie,
    });
  return { access, stores, put, calls };
}

describe("SharedCookieJar (Chrome's rules)", () => {
  it("keeps two partitioned cookies with the same name apart", async () => {
    const b = chromeLike([9001, 9002]);
    b.put(9001, { name: "cid", value: "for-a", partitionKey: { topLevelSite: "https://a.test" } });
    b.put(9001, { name: "cid", value: "for-b", partitionKey: { topLevelSite: "https://b.test" } });
    const jar = new SharedCookieJar(b.access);
    await jar.sync(9002, [9001, 9002]);
    const got = b.stores
      .get(9002)!
      .filter((c) => c.name === "cid")
      .map((c) => c.value);
    expect(got.sort()).toEqual(["for-a", "for-b"]);
    expect(b.stores.get(9002)!.every((c) => c.partitionKey)).toBe(true);
  });

  it("never shares Google's rotating cookies between browsers", async () => {
    const b = chromeLike([9001, 9002]);
    b.put(9001, { name: "SID", value: "session", domain: ".google.com" });
    b.put(9001, { name: "__Secure-1PSIDTS", value: "rotated-here", domain: ".google.com" });
    b.put(9002, { name: "__Secure-1PSIDTS", value: "rotated-there", domain: ".google.com" });
    const jar = new SharedCookieJar(b.access);
    await jar.sync(9002, [9001, 9002]);
    await jar.sync(9001, [9001, 9002]);
    const value = (port: number, name: string) =>
      b.stores.get(port)!.find((c) => c.name === name)?.value;
    expect(value(9002, "SID")).toBe("session");
    expect(value(9002, "__Secure-1PSIDTS")).toBe("rotated-there");
    expect(value(9001, "__Secure-1PSIDTS")).toBe("rotated-here");
  });

  it("sets __Host- cookies host-only and drops cookies Chrome would refuse", async () => {
    const b = chromeLike([9001, 9002]);
    b.put(9001, { name: "__Host-sid", value: "h", domain: "app.example.com" });
    b.put(9001, { name: "__Secure-x", value: "s", secure: false });
    b.put(9001, { name: "lax", value: "n", sameSite: "None", secure: false });
    const reports: unknown[] = [];
    const jar = new SharedCookieJar(b.access, undefined, undefined, (r) => reports.push(r));
    await jar.sync(9002, [9001, 9002]);
    const host = b.stores.get(9002)!.find((c) => c.name === "__Host-sid");
    expect(host).toMatchObject({ value: "h", domain: "app.example.com" });
    expect(b.stores.get(9002)!.some((c) => c.name === "__Secure-x" || c.name === "lax")).toBe(
      false,
    );
    expect(reports.at(-1)).toMatchObject({
      kind: "cookie_sync",
      injected: 1,
      rejected: 2,
      outcome: "partial",
    });
  });

  it("retries one by one when the browser refuses the batch, keeping the good cookies", async () => {
    const b = chromeLike([9001, 9002], ["bad"]);
    b.put(9001, { name: "good", value: "1" });
    b.put(9001, { name: "bad", value: "2" });
    const reports: Array<{ outcome: string }> = [];
    const jar = new SharedCookieJar(b.access, undefined, undefined, (r) => reports.push(r));
    await jar.sync(9002, [9001, 9002]);
    expect(b.stores.get(9002)!.map((c) => c.name)).toEqual(["good"]);
    expect(reports.at(-1)?.outcome).toBe("partial");
  });
});
