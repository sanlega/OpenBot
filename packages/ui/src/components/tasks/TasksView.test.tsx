import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transport } from "../../transport/types.js";
import { TasksView, type TaskRow } from "./TasksView.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport, bots: [], state: { lastSeq: 0 } }),
}));
afterEach(cleanup);

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: "dlg_1",
  chainId: "chn_1",
  requesterBotId: "bot_chief",
  assigneeBotId: "bot_worker",
  ownerThreadId: "thr_1",
  title: "Compare three CRM tools",
  state: "working",
  roundTrips: 1,
  wakePending: false,
  requesterName: "Chief of Staff",
  assigneeName: "Researcher",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:05:00.000Z",
  lastEventAt: "2026-10-01T10:05:00.000Z",
  ...over,
});

describe("TasksView (L3)", () => {
  it("shows tasks in progress first, and all with their results", async () => {
    transport = {
      get: vi.fn(async () => ({
        tasks: [
          task({}),
          task({
            id: "dlg_2",
            title: "Write the summary",
            state: "completed",
            result: "Done: see report.md",
          }),
        ],
      })),
      post: vi.fn(),
    } as unknown as Transport;
    render(<TasksView />);
    expect(await screen.findByText("Compare three CRM tools")).toBeTruthy();
    expect(screen.queryByText("Write the summary")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.click(screen.getByText("Write the summary"));
    expect(screen.getByText("Done: see report.md")).toBeTruthy();
  });

  it("cancels an open task after a confirmation", async () => {
    const post = vi.fn(async () => ({ cancelled: ["dlg_1"] }));
    transport = { get: vi.fn(async () => ({ tasks: [task({})] })), post } as unknown as Transport;
    render(<TasksView />);
    await userEvent.click(await screen.findByText("Compare three CRM tools"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel…" }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Stops Researcher and any task it handed on/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(post).toHaveBeenCalledWith("/api/tasks/dlg_1/cancel", {});
  });

  it("says who needs an answer and opens the conversation to give it", async () => {
    transport = {
      get: vi.fn(async () => ({
        tasks: [task({ state: "input_required", statusMessage: "Which currency?" })],
      })),
      post: vi.fn(),
    } as unknown as Transport;
    const onOpenThread = vi.fn();
    render(<TasksView onOpenThread={onOpenThread} />);
    await userEvent.click(await screen.findByText("Compare three CRM tools"));
    expect(screen.getByText(/Researcher needs an answer: Which currency\?/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Answer it" }));
    expect(onOpenThread).toHaveBeenCalledWith("thr_1");
  });

  it("shows a result as formatted text", async () => {
    transport = {
      get: vi.fn(async () => ({
        tasks: [task({ state: "completed", result: "**Winner:** HubSpot" })],
      })),
      post: vi.fn(),
    } as unknown as Transport;
    render(<TasksView />);
    await userEvent.click(await screen.findByRole("button", { name: "All" }));
    await userEvent.click(screen.getByText("Compare three CRM tools"));
    expect(screen.getByText("Winner:").tagName).toBe("STRONG");
  });
});

describe("TasksView when the harness does not answer", () => {
  it("says it could not load and offers to try again", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ tasks: [task({})] });
    transport = { get, post: vi.fn() } as unknown as Transport;
    render(<TasksView />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Compare three CRM tools")).toBeTruthy();
  });
});
