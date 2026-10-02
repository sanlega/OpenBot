import { describe, expect, it } from "vitest";
import type { Decision } from "@openbot/contracts";
import { compareAnswer, compareDecisions, formatReport } from "./decisions-compare.js";

const decision = (
  id: string,
  purpose: string,
  answers: Decision["answers"],
  withRequest = true,
): Decision => ({
  id,
  purpose,
  provider: "jev",
  model: "jev-1.13.0",
  stateHash: "h",
  ...(withRequest
    ? {
        request: {
          state: { x: id },
          questions: Object.fromEntries(
            Object.keys(answers).map((q) => [q, { type: "noul", instructions: q }]),
          ),
        },
      }
    : {}),
  answers,
  band: "auto",
  outcome: "allow",
  createdAt: "2026-10-02T00:00:00.000Z",
});

describe("openbot decisions compare (V2)", () => {
  it("counts the same meaning as agreement", () => {
    expect(compareAnswer({ type: "noul", noul: 0.9 }, { type: "noul", noul: 0.6 })).toBe("agree");
    expect(compareAnswer({ type: "noul", noul: 0.9 }, { type: "noul", noul: 0.4 })).toBe(
      "disagree",
    );
    expect(
      compareAnswer(
        { type: "choice", choice: "a", confidence: 1, probabilities: {} },
        { type: "choice", choice: "a", confidence: 0.3, probabilities: {} },
      ),
    ).toBe("agree");
    expect(
      compareAnswer({ type: "score", score: 1.2, confidence: 1 }, {
        type: "score",
        score: 0.8,
        confidence: 1,
      } as never),
    ).toBe("agree");
    expect(compareAnswer({ type: "noul", noul: 1 }, undefined)).toBe("missing");
  });

  it("replays recorded requests per purpose, and tells refusals from failures", async () => {
    const decisions = [
      decision("d1", "risk", { side: { type: "noul", noul: 0.9 } }),
      decision("d2", "risk", { side: { type: "noul", noul: 0.1 } }),
      decision("d3", "spawn", { user_requested: { type: "noul", noul: 0.95 } }),
      decision("d4", "computer", { action: { type: "noul", noul: 1 } }),
      decision("d5", "notify", { deliver: { type: "noul", noul: 1 } }),
      decision("d6", "risk", { side: { type: "noul", noul: 1 } }, false),
    ];
    const reports = await compareDecisions(decisions, {
      url: "http://local",
      client: () => ({
        systemOne: async (call) => {
          const id = (call.state as { x: string }).x;
          if (id === "d4") throw Object.assign(new Error("too many options"), { status: 422 });
          if (id === "d5") throw Object.assign(new Error("timeout"), { status: 408 });
          return {
            latencyMs: 40,
            response: {
              model: "laya",
              answers: id === "d3" ? {} : { side: { type: "noul", noul: id === "d1" ? 0.8 : 0.7 } },
            } as never,
          };
        },
      }),
    });
    const risk = reports.find((r) => r.purpose === "risk")!;
    // d6 kept nothing: not replayed.
    expect(risk).toMatchObject({
      decisions: 2,
      agree: 1,
      disagree: 1,
      agreement: 0.5,
      meanLatencyMs: 40,
    });
    expect(reports.find((r) => r.purpose === "spawn")).toMatchObject({ missing: 1 });
    expect(reports.find((r) => r.purpose === "computer")).toMatchObject({ refused: 1, failed: 0 });
    expect(reports.find((r) => r.purpose === "notify")).toMatchObject({ refused: 0, failed: 1 });
    expect(formatReport(reports)).toMatch(/risk\s+2\s+50%/);
    expect(formatReport([])).toMatch(/No decisions have kept/);
  });
});
