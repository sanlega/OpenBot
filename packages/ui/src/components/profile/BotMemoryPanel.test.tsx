import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Memory } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { BotMemoryPanel, UNDO_MS } from "./BotMemoryPanel.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport, bots: [{ id: "bot_chief", name: "Chief of Staff" }] }),
}));

afterEach(cleanup);

const MEMORIES: Memory[] = [
  {
    id: "mem_1",
    scope: "bot",
    botId: "bot_a",
    tier: "profile",
    content: "Reports go in a table",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "mem_2",
    scope: "user",
    botId: "bot_chief",
    tier: "profile",
    content: "The user is called Alex",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
];

describe("BotMemoryPanel (C5)", () => {
  it("lists what the bot knows, deletes one with a moment to undo", async () => {
    const del = vi.fn(async () => ({ ok: true }));
    transport = {
      get: vi.fn(async () => ({ memories: MEMORIES })),
      delete: del,
      patch: vi.fn(),
    } as unknown as Transport;
    render(<BotMemoryPanel botId="bot_a" />);
    expect(await screen.findByText("Reports go in a table")).toBeTruthy();
    expect(screen.getByText(/About you · from Chief of Staff/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Delete: Reports go in a table" }));
    expect(screen.queryByText("Reports go in a table")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
    expect(screen.getByText("Reports go in a table")).toBeTruthy();
    expect(del).not.toHaveBeenCalled();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(screen.getByRole("button", { name: "Delete: Reports go in a table" }));
      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 10);
      });
      expect(del).toHaveBeenCalledWith("/api/memories/mem_1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits a fact in place, never saving an empty one", async () => {
    const patch = vi.fn(async () => ({}));
    transport = {
      get: vi.fn(async () => ({ memories: [MEMORIES[0]] })),
      delete: vi.fn(),
      patch,
    } as unknown as Transport;
    render(<BotMemoryPanel botId="bot_a" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit: Reports go in a table" }),
    );
    const input = screen.getByLabelText("Edit memory");
    expect(document.activeElement).toBe(input);
    await userEvent.clear(input);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(patch).not.toHaveBeenCalled();
    await userEvent.type(input, "Reports go in a short table");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(patch).toHaveBeenCalledWith("/api/memories/mem_1", {
      content: "Reports go in a short table",
    });
    expect(await screen.findByText("Reports go in a short table")).toBeTruthy();
  });

  it("says plainly when it can't load, and tries again", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("GET /api/bots/bot_a/memories failed: 500"))
      .mockResolvedValueOnce({ memories: MEMORIES });
    transport = { get, delete: vi.fn(), patch: vi.fn() } as unknown as Transport;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<BotMemoryPanel botId="bot_a" />);
    expect(await screen.findByText("Couldn't load what this bot remembers.")).toBeTruthy();
    expect(screen.queryByText(/failed: 500/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Reports go in a table")).toBeTruthy();
  });
});
