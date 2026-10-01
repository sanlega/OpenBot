import { describe, expect, it } from "vitest";
import { SharedLocalStorage, type PageStorage, type StorageAccess } from "./storage-share.js";

/** Browsers by port, each showing one page with its localStorage. */
function pages(initial: Record<number, PageStorage>) {
  const state = new Map(
    Object.entries(initial).map(([p, page]) => [Number(p), structuredClone(page)]),
  );
  const reloads: number[] = [];
  const access: StorageAccess = {
    async read(port) {
      return structuredClone(state.get(port));
    },
    async write(port, origin, items) {
      const page = state.get(port)!;
      if (page.origin !== origin) return;
      for (const [k, v] of Object.entries(items)) if (!page.items[k]) page.items[k] = v;
    },
    async reload(port) {
      reloads.push(port);
    },
  };
  return { access, state, reloads };
}

describe("SharedLocalStorage (B2)", () => {
  it("a sign-in kept in localStorage on one screen reaches another screen on that site", async () => {
    const b = pages({
      9001: { origin: "https://app.example", items: { "auth.token": "abc", theme: "dark" } },
      9002: { origin: "https://app.example", items: { theme: "light" } },
    });
    const share = new SharedLocalStorage(b.access);
    const result = await share.sync(9002, [9001, 9002]);
    expect(result).toEqual({ seeded: 1, reloaded: true });
    // Its own value is never overwritten; the missing session is added.
    expect(b.state.get(9002)!.items).toEqual({ theme: "light", "auth.token": "abc" });
    expect(b.reloads).toEqual([9002]);
    // Nothing new: no second reload.
    expect(await share.sync(9002, [9001, 9002])).toEqual({ seeded: 0, reloaded: false });
  });

  it("never mixes sites, and never deletes", async () => {
    const b = pages({
      9001: { origin: "https://a.example", items: { token: "for-a" } },
      9002: { origin: "https://b.example", items: {} },
    });
    const share = new SharedLocalStorage(b.access);
    await share.sync(9002, [9001, 9002]);
    expect(b.state.get(9002)!.items).toEqual({});
    b.state.get(9001)!.items = {};
    await share.sync(9001, [9001]);
    expect(share.itemsFor("https://a.example")).toEqual({ token: "for-a" });
  });

  it("stops reloading a site that keeps changing (3 a minute)", async () => {
    let now = 0;
    const b = pages({ 9001: { origin: "https://app.example", items: {} } });
    const share = new SharedLocalStorage(b.access, undefined, () => now);
    for (let i = 0; i < 5; i++) {
      b.state.set(9002, { origin: "https://app.example", items: { [`k${i}`]: "v" } });
      b.state.get(9001)!.items = {};
      share.forget(9001);
      await share.sync(9001, [9001, 9002]);
      now += 1_000;
    }
    expect(b.reloads).toHaveLength(3);
  });
});
