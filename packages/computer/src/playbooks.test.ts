import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlaybookStore, playbookHost } from "./playbooks.js";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("PlaybookStore (C9)", () => {
  it("keeps the deep link and steps of a route that worked, per site", () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-pb-"));
    const store = new PlaybookStore(dir);
    store.record({
      goal: "Search for lofi music and open the first video",
      startUrl: "https://www.youtube.com/",
      endUrl: "https://www.youtube.com/watch?v=abc",
      steps: ['type "Search"', 'click "First result"'],
      needed: [],
      at: "2026-10-01T10:00:00.000Z",
    });
    const text = store.read("https://youtube.com/results?q=x")!;
    expect(text).toContain("# Playbook: youtube.com");
    expect(text).toContain("deep link (where it ended): https://www.youtube.com/watch?v=abc");
    expect(text).toContain('type "Search" → click "First result"');
    expect(readFileSync(join(dir, "youtube.com.md"), "utf8")).toContain("Search for lofi music");
    expect(store.read("https://example.com/")).toBeUndefined();
  });

  it("keeps the latest few routes and replaces one with the same goal", () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-pb-"));
    const store = new PlaybookStore(dir);
    for (let i = 0; i < 7; i++) {
      store.record({
        goal: i === 6 ? "goal 5" : `goal ${i}`,
        endUrl: "https://site.example/x",
        steps: [`step ${i}`],
        needed: [],
        at: `2026-10-0${1 + (i % 9)}T00:00:00.000Z`,
      });
    }
    const text = store.read("https://site.example/")!;
    expect(text.match(/^## /gm)).toHaveLength(5);
    expect(text).toContain("step 6");
    expect(text).not.toContain("step 5");
  });

  it("names sites without www and ignores bad URLs", () => {
    expect(playbookHost("https://WWW.Example.com/a")).toBe("example.com");
    expect(playbookHost("not a url")).toBeUndefined();
  });
});
