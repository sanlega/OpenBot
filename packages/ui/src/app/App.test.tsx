import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Transport } from "../transport/types.js";
import { OpenBotApp } from "./App.js";

afterEach(cleanup);

function failingTransport(status?: number): Transport {
  return {
    baseUrl: "http://192.168.1.20:4577",
    get: vi.fn(async () => {
      const error = new Error("failed") as Error & { status?: number };
      if (status) error.status = status;
      throw error;
    }),
  } as unknown as Transport;
}

describe("OpenBotApp connection screen (R1)", () => {
  it("tells an unpaired device how to pair instead of saying OpenBot is unreachable", async () => {
    render(<OpenBotApp transport={failingTransport(401)} />);
    expect(await screen.findByText("This device isn't paired")).toBeInTheDocument();
    expect(screen.getByText(/choose Pair a phone/)).toBeInTheDocument();
    expect(screen.queryByText("Can't reach OpenBot")).toBeNull();
  });

  it("says OpenBot can't be reached when nothing answers", async () => {
    render(<OpenBotApp transport={failingTransport()} />);
    expect(await screen.findByText("Can't reach OpenBot")).toBeInTheDocument();
  });
});
