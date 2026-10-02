import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Settings } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { checkSummary, DecisionProviderCard } from "./DecisionProviderCard.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({ useOpenBot: () => ({ transport }) }));
afterEach(cleanup);

const settings: Settings = {
  id: "singleton",
  caps: {},
  budgets: {},
  updatedAt: "2026-10-02T00:00:00.000Z",
};

function fakeTransport(checkOk = true) {
  const patch = vi.fn(async (_path: string, body: { decisions: Record<string, unknown> }) => ({
    settings: { ...settings, decisions: { keepRequests: true, mode: "jev", ...body.decisions } },
  }));
  const put = vi.fn(async () => ({ saved: true }));
  const post = vi.fn(async (_p: string, body: { url: string; kind: string }) =>
    !checkOk || body.url.endsWith(":9")
      ? { ok: false, reason: "Nothing answers at that address. Is the server running?" }
      : {
          ok: true,
          model: body.kind === "vision" ? "imajev-4b" : "laya",
          latencyMs: 40,
          correct: true,
        },
  );
  transport = {
    get: vi.fn(async (path: string) =>
      path === "/api/decisions/local-key"
        ? { saved: false }
        : { decisions: [{ provider: "jev" }, { provider: "jev" }, { provider: "local" }] },
    ),
    patch,
    put,
    post,
  } as unknown as Transport;
  return { patch, put, post };
}

const saveButton = () => screen.getByRole("button", { name: "Save decision model" });

describe("Settings > Jev > Decision model (D-037)", () => {
  it("shows the server fields only when they are used, and needs an address for Hybrid", async () => {
    fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    expect(await screen.findByText(/Of the last 3: 2 by Jev, 1 by your server/)).toBeTruthy();
    expect(screen.queryByLabelText("Your decision server")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
    expect(screen.getByLabelText("Your decision server")).toBeTruthy();
    expect(screen.getByText(/Add your server's address to use Hybrid/)).toBeTruthy();
    expect(saveButton()).toBeDisabled();
  });

  it("checks the server, forgets the result when the address changes, and saves with its key", async () => {
    const { patch, put, post } = fakeTransport();
    const onSaved = vi.fn();
    render(<DecisionProviderCard settings={settings} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
    const address = screen.getByLabelText("Your decision server");
    await userEvent.type(address, "http://127.0.0.1:8000");
    await userEvent.click(screen.getByRole("button", { name: "Check decision server" }));
    expect(post).toHaveBeenCalledWith("/api/decisions/check", {
      url: "http://127.0.0.1:8000",
      kind: "text",
    });
    expect(
      await screen.findByText(/laya answered in 40 ms, and got the test question right/),
    ).toBeTruthy();
    await userEvent.type(address, "1");
    expect(screen.queryByText(/laya answered/)).toBeNull();
    await userEvent.clear(address);
    await userEvent.type(address, "http://127.0.0.1:8000");

    await userEvent.type(screen.getByLabelText("Server key"), "k-1");
    await userEvent.click(saveButton());
    expect(put).toHaveBeenCalledWith("/api/decisions/local-key", { key: "k-1" });
    expect(patch).toHaveBeenCalledWith("/api/settings", {
      decisions: { mode: "hybrid", localUrl: "http://127.0.0.1:8000", visionUrl: "" },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Saved. New decisions use it now.")).toBeTruthy();
  });

  it("won't save Local only until the server passes the check", async () => {
    const { patch } = fakeTransport(false);
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Local only" }));
    await userEvent.type(screen.getByLabelText("Your decision server"), "http://127.0.0.1:8000");
    await userEvent.click(saveButton());
    expect(await screen.findByText(/Local only wasn't saved/)).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it("checks a vision server with its own button", async () => {
    const { post } = fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Visual checks"), "http://127.0.0.1:8765");
    await userEvent.click(screen.getByRole("button", { name: "Check visual checks server" }));
    expect(post).toHaveBeenLastCalledWith("/api/decisions/check", {
      url: "http://127.0.0.1:8765",
      kind: "vision",
    });
    expect(await screen.findByText(/imajev-4b answered/)).toBeTruthy();
  });

  it("asks before turning off the history, which deletes what was kept", async () => {
    const { patch } = fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("switch", { name: "Keep what each decision saw" }));
    expect(patch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Turn off and delete" }));
    expect(patch).toHaveBeenCalledWith("/api/settings", { decisions: { keepRequests: false } });
    expect(await screen.findByText(/What was kept is deleted/)).toBeTruthy();
  });

  it("moves the choice with the arrow keys", async () => {
    fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    screen.getByRole("radio", { name: "Jev" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Hybrid" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls a model that gets the probe wrong unfit", () => {
    expect(checkSummary({ ok: true, model: "x", latencyMs: 2000, correct: false })).toBe(
      "x answered in 2.0 s, but got a simple test question wrong. It isn't fit to decide yet.",
    );
  });
});
