import { describe, expect, it } from "vitest";
import type { Turn } from "@openbot/contracts";
import { latencySummary } from "./remote-and-audit.js";

const turn = (i: number, setup: number, text: number): Turn => {
  const q = Date.UTC(2026, 9, 1, 10, 0, i);
  const at = (ms: number) => new Date(q + ms).toISOString();
  return {
    id: `turn_${i}`,
    botId: "bot_a",
    chainId: "chn_a",
    engine: "claude",
    model: "m",
    status: "completed",
    usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    latency: {
      queuedAt: at(0),
      engineStartedAt: at(setup),
      firstDeltaAt: at(text),
      completedAt: at(text + 1000),
    },
    createdAt: at(0),
  };
};

describe("latencySummary (C10)", () => {
  it("gives medians of setup, first text and total time", () => {
    const summary = latencySummary([turn(1, 100, 900), turn(2, 300, 2100), turn(3, 200, 1500)]);
    expect(summary).toMatchObject({
      turns: 3,
      medianSetupMs: 200,
      medianFirstTextMs: 1500,
      medianTotalMs: 2500,
    });
    expect(summary.medianFirstToolMs).toBeUndefined();
  });
});

describe("cache reuse (C6)", () => {
  it("is the share of input read from the prompt cache", () => {
    const withCache = (input: number, read: number): Turn => ({
      ...turn(1, 100, 200),
      usage: { inputTokens: input, outputTokens: 0, usd: 0, cacheReadTokens: read },
    });
    expect(latencySummary([withCache(200, 800), withCache(0, 0)]).cacheReuse).toBe(0.8);
    expect(latencySummary([turn(1, 100, 200)]).cacheReuse).toBeUndefined();
  });
});
