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

function fakeTransport() {
  const patch = vi.fn(async (_path: string, body: { decisions: Record<string, unknown> }) => ({
    settings: { ...settings, decisions: { keepRequests: true, mode: "jev", ...body.decisions } },
  }));
  const put = vi.fn(async () => ({ saved: true }));
  const post = vi.fn(async (_p: string, body: { url: string; kind: string }) =>
    body.url.endsWith(":9")
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

describe("Settings > Jev > Decision model (D-037)", () => {
  it("won't switch to hybrid without a server, then checks and saves it with its key", async () => {
    const { patch, put, post } = fakeTransport();
    const onSaved = vi.fn();
    render(<DecisionProviderCard settings={settings} onSaved={onSaved} />);
    expect(await screen.findByText(/Of the last 3: 2 by Jev, 1 by your server/)).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
    expect(screen.getByText(/Add your server's address to use Hybrid/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Your decision server"), "http://127.0.0.1:8000");
    await userEvent.click(screen.getAllByRole("button", { name: "Check connection" })[0]!);
    expect(post).toHaveBeenCalledWith("/api/decisions/check", {
      url: "http://127.0.0.1:8000",
      kind: "text",
    });
    expect(
      await screen.findByText(/laya answered in 40 ms, and got the test question right/),
    ).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Server key"), "k-1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(put).toHaveBeenCalledWith("/api/decisions/local-key", { key: "k-1" });
    expect(patch).toHaveBeenCalledWith("/api/settings", {
      decisions: { mode: "hybrid", localUrl: "http://127.0.0.1:8000", visionUrl: "" },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText("Saved. New decisions use it now.")).toBeTruthy();
  });

  it("says plainly when the server doesn't answer, and checks a vision server with a picture", async () => {
    const { post } = fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Your decision server"), "http://127.0.0.1:9");
    await userEvent.click(screen.getAllByRole("button", { name: "Check connection" })[0]!);
    expect(await screen.findByText(/Nothing answers at that address/)).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Visual checks"), "http://127.0.0.1:8765");
    await userEvent.click(screen.getAllByRole("button", { name: "Check connection" })[1]!);
    expect(post).toHaveBeenLastCalledWith("/api/decisions/check", {
      url: "http://127.0.0.1:8765",
      kind: "vision",
    });
    expect(await screen.findByText(/imajev-4b answered/)).toBeTruthy();
  });

  it("turns off keeping what decisions saw at once", async () => {
    const { patch } = fakeTransport();
    render(<DecisionProviderCard settings={settings} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("switch", { name: "Keep what each decision saw" }));
    expect(patch).toHaveBeenCalledWith("/api/settings", { decisions: { keepRequests: false } });
  });

  it("calls a model that gets the probe wrong unfit", () => {
    expect(checkSummary({ ok: true, model: "x", latencyMs: 2000, correct: false })).toBe(
      "x answered in 2.0 s, but got a simple test question wrong. It isn't fit to decide yet.",
    );
  });
});
