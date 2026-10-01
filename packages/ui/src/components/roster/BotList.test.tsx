import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Bot } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { BotList } from "./BotList.js";

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot =>
  ({
    id,
    slug: name.toLowerCase(),
    name,
    description: `${name} does things`,
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "full",
    computer: "docker",
    connectors: [],
    limits: {},
    ...extra,
  }) as Bot;

const chief = bot("bot_c", "Chief", { isChiefOfStaff: true });
const writer = bot("bot_w", "Writer");
let transport: Transport;
const selectThread = vi.fn();

vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({
    bots: [chief, writer],
    threads: [
      { id: "thr_c", botId: "bot_c", kind: "dm", createdAt: "", title: "Chief" },
      { id: "thr_w", botId: "bot_w", kind: "dm", createdAt: "", title: "Writer" },
    ],
    selectedThreadId: "thr_w",
    selectThread,
    pendingApprovals: [],
    state: { inputs: new Map(), turns: new Map() },
    transport,
  }),
}));

afterEach(cleanup);

function fakeTransport() {
  const post = vi.fn(async () => ({ ok: true }));
  const patch = vi.fn(async () => ({}));
  const del = vi.fn(async () => ({ ok: true }));
  transport = { post, patch, delete: del } as unknown as Transport;
  return { post, patch, del };
}

describe("BotList actions", () => {
  it("renames a bot from its menu", async () => {
    const { patch } = fakeTransport();
    render(<BotList />);
    await userEvent.click(screen.getByLabelText("More actions for Writer"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("New name for Writer");
    await userEvent.clear(input);
    await userEvent.type(input, "Copywriter{Enter}");
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/bots/bot_w", { name: "Copywriter" }),
    );
  });

  it("asks before deleting, and only deletes on confirm", async () => {
    const { del } = fakeTransport();
    render(<BotList />);
    fireEvent.contextMenu(screen.getByText("Writer"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete bot" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Writer?" });
    expect(dialog).toHaveTextContent("The Chief of Staff keeps a note of what it did");
    // The safe button has focus: Enter right away cancels.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete bot" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/bots/bot_w"));
    expect(selectThread).toHaveBeenCalledWith("thr_c");
  });

  it("clears a chat after confirming", async () => {
    const { post } = fakeTransport();
    render(<BotList />);
    await userEvent.click(screen.getByLabelText("More actions for Writer"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear chat" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/threads/thr_w/clear", {}));
  });

  it("never offers to delete the Chief of Staff", async () => {
    fakeTransport();
    render(<BotList />);
    await userEvent.click(screen.getByLabelText("More actions for Chief"));
    expect(screen.queryByRole("menuitem", { name: "Delete bot" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });
});
