import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoxDiagnostics } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { ComputerHealthCard } from "./ComputerHealthCard.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport, state: {}, bots: [{ id: "bot_a", name: "Researcher" }] }),
}));

afterEach(cleanup);

const REPORT: BoxDiagnostics = {
  ok: false,
  checks: [
    { name: "browser", ok: true, detail: "Chromium 130" },
    { name: "clock", ok: false, detail: "120 s off" },
  ],
  screens: [
    {
      botId: "bot_a",
      display: 1,
      components: [
        { name: "browser", up: true, restartsInWindow: 2, crashloop: false, downReason: "oom" },
        { name: "vnc", up: true, restartsInWindow: 0, crashloop: false },
      ],
    },
  ],
  telemetry: [],
};

describe("ComputerHealthCard", () => {
  it("runs the self-check and names what failed and what restarted", async () => {
    const get = vi.fn(async (path: string) =>
      path === "/api/computer/status" ? { provider: "docker" } : REPORT,
    );
    transport = { get, post: vi.fn() } as unknown as Transport;
    render(<ComputerHealthCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Run self-check" }));
    expect(await screen.findByText("1 problem")).toBeTruthy();
    expect(screen.getByText("Clock")).toBeTruthy();
    expect(screen.getByText(/The time is off/)).toBeTruthy();
    // The raw finding is kept, folded away.
    expect(screen.getByText("120 s off").closest("details")).toBeTruthy();
    expect(screen.getByText("Researcher's browser")).toBeTruthy();
    expect(screen.getByText(/Restarted 2 times in the last 10 minutes/)).toBeTruthy();
    // No internal ids on screen.
    expect(screen.queryByText(/bot_a|Screen :1/)).toBeNull();
    // A component that never restarted is not listed.
    expect(screen.queryByText("Researcher's live view")).toBeNull();
  });

  it("asks before refreshing the computer, then checks again", async () => {
    const get = vi.fn(async (path: string) =>
      path === "/api/computer/status"
        ? { provider: "docker" }
        : { ...REPORT, ok: true, checks: [] },
    );
    const post = vi.fn(async () => ({ ready: true }));
    transport = { get, post } as unknown as Transport;
    render(<ComputerHealthCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(post).toHaveBeenCalledWith("/api/computer/recreate", {});
    expect(await screen.findByText("All good")).toBeTruthy();
  });

  it("stays hidden when the computer is not the virtual machine", async () => {
    transport = {
      get: vi.fn(async () => ({ provider: "local" })),
      post: vi.fn(),
    } as unknown as Transport;
    const { container } = render(<ComputerHealthCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });
});
