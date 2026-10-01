import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transport } from "../../transport/types.js";
import { WorkspaceFiles, commandOutcome, sizeLabel } from "./WorkspaceFiles.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport, state: { lastSeq: 0 } }),
}));
afterEach(cleanup);

describe("WorkspaceFiles (N2)", () => {
  it("browses folders, opens a file and shows the bot's latest commands", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === "/api/workspace/files?path=")
        return {
          entries: [{ name: "reports", kind: "dir", size: 0, modifiedAt: "2026-10-01T10:00:00Z" }],
        };
      if (path === "/api/workspace/files?path=reports")
        return {
          entries: [
            { name: "plan.md", kind: "file", size: 2048, modifiedAt: "2026-10-01T10:00:00Z" },
          ],
        };
      if (path.startsWith("/api/workspace/file?path=reports%2Fplan.md"))
        return {
          path: "reports/plan.md",
          size: 2048,
          binary: false,
          truncated: false,
          text: "# Plan",
        };
      if (path === "/api/bots/bot_a/commands")
        return {
          commands: [{ command: "npm run build", at: "2026-10-01T10:00:00Z", exitCode: 2 }],
        };
      throw new Error(path);
    });
    transport = { get } as unknown as Transport;
    render(<WorkspaceFiles botId="bot_a" />);
    await userEvent.click(await screen.findByText("reports"));
    await userEvent.click(await screen.findByText("plan.md"));
    // Markdown files are shown formatted.
    expect(await screen.findByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(await screen.findByText("npm run build")).toBeTruthy();
    expect(screen.getByText("Failed (exit 2)")).toBeTruthy();
    // Back to the top through the breadcrumb.
    await userEvent.click(screen.getByRole("button", { name: "workspace" }));
    expect(await screen.findByText("reports")).toBeTruthy();
  });

  it("opens a link to a file as a file, and never one pointing outside", async () => {
    const at = "2026-10-01T10:00:00Z";
    const get = vi.fn(async (path: string) => {
      if (path === "/api/workspace/files?path=")
        return {
          entries: [
            { name: "latest.md", kind: "link", target: "file", size: 0, modifiedAt: at },
            { name: "escape", kind: "link", target: "outside", size: 0, modifiedAt: at },
          ],
        };
      if (path.startsWith("/api/workspace/file?path=latest.md"))
        return { path: "latest.md", size: 3, binary: false, truncated: false, text: "# L" };
      if (path === "/api/bots/bot_a/commands") return { commands: [] };
      throw new Error(path);
    });
    transport = { get } as unknown as Transport;
    render(<WorkspaceFiles botId="bot_a" />);
    await userEvent.click(await screen.findByText("latest.md"));
    expect(await screen.findByRole("heading", { name: "L" })).toBeTruthy();
    expect(screen.getByText("escape").closest("button")).toBeDisabled();
  });

  it("formats sizes", () => {
    expect([sizeLabel(512), sizeLabel(2048), sizeLabel(5 * 1024 * 1024)]).toEqual([
      "512 B",
      "2.0 KB",
      "5.0 MB",
    ]);
  });
});

describe("WorkspaceFiles states", () => {
  it("shows one error with Try again when a folder can't be read, never 'empty'", async () => {
    let fail = true;
    const get = vi.fn(async (path: string) => {
      if (path.startsWith("/api/workspace/files")) {
        if (fail) throw new Error("GET /api/workspace/files failed: 500");
        return {
          entries: [{ name: "a.txt", kind: "file", size: 1, modifiedAt: "2026-10-01T10:00:00Z" }],
        };
      }
      return { commands: [] };
    });
    transport = { get } as unknown as Transport;
    render(<WorkspaceFiles botId="bot_a" />);
    expect(await screen.findByText(/Couldn't read this folder/)).toBeTruthy();
    expect(screen.queryByText("This folder is empty.")).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("a.txt")).toBeTruthy();
    expect(screen.getByRole("button", { name: /workspace/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("names how each command ended like the other status pills", () => {
    expect(commandOutcome({ command: "x", at: "", exitCode: 0 })).toEqual({
      label: "Done",
      tone: "success",
    });
    expect(commandOutcome({ command: "x", at: "", timedOut: true })?.label).toBe("Timed out");
    expect(commandOutcome({ command: "x", at: "", exitCode: 1 })?.label).toBe("Failed (exit 1)");
    expect(commandOutcome({ command: "x", at: "" })).toBeNull();
  });
});
