import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Memory } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { BotMemoryPanel } from "./BotMemoryPanel.js";

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
  it("lists what the bot knows, says where shared facts came from, and deletes one", async () => {
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
    expect(del).toHaveBeenCalledWith("/api/memories/mem_1");
    expect(screen.queryByText("Reports go in a table")).toBeNull();
  });

  it("edits a fact in place", async () => {
    const patch = vi.fn(async () => ({}));
    transport = {
      get: vi.fn(async () => ({ memories: [MEMORIES[0]] })),
      delete: vi.fn(),
      patch,
    } as unknown as Transport;
    render(<BotMemoryPanel botId="bot_a" />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Edit memory");
    await userEvent.clear(input);
    await userEvent.type(input, "Reports go in a short table{Enter}");
    expect(patch).toHaveBeenCalledWith("/api/memories/mem_1", {
      content: "Reports go in a short table",
    });
    expect(await screen.findByText("Reports go in a short table")).toBeTruthy();
  });
});
