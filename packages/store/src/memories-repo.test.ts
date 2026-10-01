import { afterEach, describe, expect, it } from "vitest";
import { newId, type Memory } from "@openbot/contracts";
import { openDb } from "./db.js";
import { MemoriesRepo } from "./memories-repo.js";

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

const memory = (over: Partial<Memory>): Memory => ({
  id: newId("memory"),
  scope: "bot",
  botId: "bot_a",
  tier: "profile",
  content: "fact",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

describe("MemoriesRepo (C5)", () => {
  it("a bot sees its own memories and the user's, never another bot's", () => {
    const opened = openDb({ path: ":memory:" });
    close = opened.close;
    const repo = new MemoriesRepo(opened.db);
    repo.create(memory({ content: "A's own" }));
    repo.create(memory({ botId: "bot_b", content: "B's own" }));
    repo.create(memory({ botId: "bot_b", scope: "user", content: "The owner prefers tables" }));
    expect(
      repo
        .visibleTo("bot_a")
        .map((m) => m.content)
        .sort(),
    ).toEqual(["A's own", "The owner prefers tables"]);
    expect(repo.visibleTo()).toHaveLength(3);
  });

  it("forgets for good and edits in place", () => {
    const opened = openDb({ path: ":memory:" });
    close = opened.close;
    const repo = new MemoriesRepo(opened.db);
    const m = memory({ content: "old" });
    repo.create(m);
    repo.updateContent(m.id, "new", new Date("2026-10-02T00:00:00Z"));
    expect(repo.getById(m.id)).toMatchObject({
      content: "new",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(repo.forget(m.id, new Date())).toBe(true);
    expect(repo.forget(m.id, new Date())).toBe(false);
    expect(repo.getById(m.id)).toBeUndefined();
    expect(repo.visibleTo("bot_a")).toEqual([]);
  });
});
