import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Transport } from "../../transport/types.js";
import { SpeedCard, seconds } from "./SpeedCard.js";

let transport: Transport;
vi.mock("../../state/context.js", () => ({
  useOpenBot: () => ({
    transport,
    bots: [
      { id: "bot_a", name: "Researcher" },
      { id: "bot_b", name: "New one" },
    ],
  }),
}));
vi.mock("../common/BotAvatar.js", () => ({ BotAvatar: () => null }));
afterEach(cleanup);

describe("SpeedCard (M3)", () => {
  it("shows each bot's first-words median, whole turn and cache reuse", async () => {
    transport = {
      get: vi.fn(async (path: string) =>
        path.includes("bot_a")
          ? {
              latency: {
                turns: 12,
                medianSetupMs: 900,
                medianFirstTextMs: 4200,
                medianTotalMs: 21000,
                cacheReuse: 0.82,
              },
            }
          : { latency: { turns: 0 } },
      ),
    } as unknown as Transport;
    render(<SpeedCard />);
    expect(await screen.findByText("4.2 s")).toBeTruthy();
    expect(
      screen.getByText(/whole turn 21 s · 82% of input reused from cache · 12 turns/),
    ).toBeTruthy();
    expect(screen.getByText("No measured turns yet.")).toBeTruthy();
  });

  it("formats durations", () => {
    expect([seconds(undefined), seconds(950), seconds(65_000)]).toEqual(["–", "0.9 s", "65 s"]);
  });
});
