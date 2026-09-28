import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComputerImageStatus } from "@openbot/contracts";
import type { Transport } from "../../transport/types.js";
import { ComputerImageCard } from "./ComputerImageCard.js";

let transport: Transport;
let computerImage: ComputerImageStatus | null;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({ transport, state: { computerImage } }),
}));

afterEach(cleanup);

function setTransport(
  get: (path: string) => Promise<unknown>,
  post: (path: string, body?: unknown) => Promise<unknown> = async () => ({}),
) {
  transport = { baseUrl: "http://127.0.0.1:4577", get, post } as unknown as Transport;
}

const READY: ComputerImageStatus = {
  state: "ready",
  tag: "ghcr.io/sanlega/openbot-desktop:latest",
  source: "registry",
  localBuildAvailable: false,
};

const MISSING: ComputerImageStatus = {
  state: "missing",
  tag: "ghcr.io/sanlega/openbot-desktop:latest",
  localBuildAvailable: false,
};

describe("ComputerImageCard", () => {
  beforeEach(() => {
    computerImage = null;
  });

  it("renders nothing when this OpenBot isn't using the docker provider (501)", async () => {
    setTransport(async () => {
      throw new Error("GET /api/computer/image failed: 501");
    });

    render(<ComputerImageCard />);

    await screen.findByText("Desktop image", { exact: false }).catch(() => {});
    expect(document.body.querySelector(".set-group")).not.toBeInTheDocument();
  });

  it("shows Not downloaded and a Get desktop image button when the image is missing", async () => {
    setTransport(async () => MISSING);

    render(<ComputerImageCard />);

    expect(await screen.findByText("Not downloaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get desktop image" })).toBeInTheDocument();
  });

  it("clicking Get desktop image posts source: registry and reflects the returned state", async () => {
    const post = vi.fn(
      async () => ({ ...MISSING, state: "pulling" }) satisfies ComputerImageStatus,
    );
    setTransport(async () => MISSING, post);

    render(<ComputerImageCard />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Get desktop image" }));

    expect(post).toHaveBeenCalledWith("/api/computer/image/build", { source: "registry" });
    expect(await screen.findByText("Downloading…")).toBeInTheDocument();
  });

  it("does not show Get desktop image once ready, but does show Reset", async () => {
    setTransport(async () => READY);

    render(<ComputerImageCard />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get desktop image" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("Reset requires a confirm click before calling the reset endpoint", async () => {
    const post = vi.fn(async () => ({}));
    setTransport(async () => READY, post);

    render(<ComputerImageCard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reset" }));

    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reset and re-download" }));

    expect(post).toHaveBeenCalledWith("/api/computer/image/reset", { removeImage: true });
  });

  it("reflects a computer.image_status event without a new GET", async () => {
    setTransport(async () => MISSING);
    computerImage = null;

    const { rerender } = render(<ComputerImageCard />);
    expect(await screen.findByText("Not downloaded")).toBeInTheDocument();

    computerImage = { ...MISSING, state: "pulling", source: "registry" };
    rerender(<ComputerImageCard />);

    expect(await screen.findByText("Downloading…")).toBeInTheDocument();
  });
});
