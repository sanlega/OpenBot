import { describe, expect, it } from "vitest";
import type { DecideRequest, DecisionService, Screen } from "@openbot/contracts";
import { runFastLoop } from "./fast-loop.js";

const canvasPage = {
  url: "https://draw.test/board",
  title: "Board",
  // A canvas app: the text shows nothing about what is on the board.
  elements: [{ index: 0, role: "button", label: "Menu" }],
};

function screen(withScreenshot: boolean): Screen & { shots: number } {
  const s = {
    shots: 0,
    observe: async () => canvasPage,
    act: async () => ({ ok: true }),
    liveView: async () => ({ url: "", token: "", expiresAt: "" }),
    takeover: async () => undefined,
  } as Screen & { shots: number };
  if (withScreenshot) {
    s.screenshot = async () => {
      s.shots += 1;
      return { mime: "image/jpeg", data: "AAAA" };
    };
  }
  return s;
}

/**
 * The loop waits until it runs out of steps; the text goal check says "no"; a picture answers
 * `picture` (or nothing when the service can't see images).
 */
function decisions(options: {
  seesImages: boolean;
  picture?: { goal: "yes" | "no"; goalConfidence: number; wall: number };
  seen?: DecideRequest[];
}): DecisionService {
  return {
    canSeeImages: () => options.seesImages,
    decide: async (req: DecideRequest) => {
      options.seen?.push(req);
      if (req.images?.length && options.picture) {
        return {
          answers: {
            goal_met: {
              type: "choice",
              choice: options.picture.goal,
              confidence: options.picture.goalConfidence,
              probabilities: {},
            },
            wall: { type: "noul", noul: options.picture.wall },
          },
          provider: "local",
          model: "imajev-4b",
          sawImages: true,
          latencyMs: 1,
          decisionId: "dec_visual",
        };
      }
      if (req.questions.goal_met) {
        return {
          answers: {
            goal_met: { type: "choice", choice: "no", confidence: 0.95, probabilities: {} },
          },
          provider: "jev",
          model: "jev",
          latencyMs: 1,
          decisionId: "dec_text",
        };
      }
      return {
        answers: {
          action: {
            type: "choice",
            choice: "wait",
            confidence: 0.95,
            probabilities: { wait: 0.95 },
          },
          is_destructive: { type: "noul", noul: 0.01 },
        },
        provider: "jev",
        model: "jev",
        latencyMs: 1,
        decisionId: "dec_step",
      };
    },
  } as unknown as DecisionService;
}

const base = {
  botId: "bot_1",
  chainId: "chn_1",
  providerId: "docker",
  settleMs: 0,
  maxSteps: 3,
  goal: "Draw a red circle on the board",
};

describe("visual check at the end of a computer task (V4)", () => {
  it("a sure picture of the goal done completes the task", async () => {
    const seen: DecideRequest[] = [];
    const s = screen(true);
    const result = await runFastLoop({
      ...base,
      screen: s,
      decisionService: decisions({
        seesImages: true,
        picture: { goal: "yes", goalConfidence: 0.95, wall: 0.02 },
        seen,
      }),
    });
    expect(result.status).toBe("completed");
    expect(s.shots).toBe(1);
    // Only the visual question carries the picture.
    expect(seen.filter((r) => r.images?.length)).toHaveLength(1);
  });

  it("an unsure picture changes nothing", async () => {
    const result = await runFastLoop({
      ...base,
      screen: screen(true),
      decisionService: decisions({
        seesImages: true,
        picture: { goal: "yes", goalConfidence: 0.7, wall: 0.3 },
      }),
    });
    expect(result.status).not.toBe("completed");
    expect(result.summary).not.toMatch(/sign-in page, a CAPTCHA/);
  });

  it("a wall on the picture is named in the result", async () => {
    const result = await runFastLoop({
      ...base,
      screen: screen(true),
      decisionService: decisions({
        seesImages: true,
        picture: { goal: "no", goalConfidence: 0.95, wall: 0.97 },
      }),
    });
    expect(result.status).not.toBe("completed");
    expect(result.summary).toMatch(/sign-in page, a CAPTCHA or a bot check/);
  });

  it("no picture is taken without an image model, or without a screen that can take one", async () => {
    const a = screen(true);
    await runFastLoop({ ...base, screen: a, decisionService: decisions({ seesImages: false }) });
    expect(a.shots).toBe(0);
    const b = screen(false);
    const result = await runFastLoop({
      ...base,
      screen: b,
      decisionService: decisions({ seesImages: true }),
    });
    expect(result.status).not.toBe("completed");
  });

  it("a screenshot that fails never stops the task from ending as before", async () => {
    const s = screen(true);
    s.screenshot = async () => {
      throw new Error("daemon too old");
    };
    const result = await runFastLoop({
      ...base,
      screen: s,
      decisionService: decisions({
        seesImages: true,
        picture: { goal: "yes", goalConfidence: 1, wall: 0 },
      }),
    });
    expect(["failed", "escalated"]).toContain(result.status);
  });
});

describe("a visual answer that didn't read the picture (M1)", () => {
  it("never completes the task, even when a model says yes from the text", async () => {
    const service = {
      canSeeImages: () => true,
      decide: async (req: DecideRequest) => {
        if (req.images?.length) {
          // Like Jev answering from the URL alone after the image server failed.
          return {
            answers: {
              goal_met: { type: "choice", choice: "yes", confidence: 0.99, probabilities: {} },
              wall: { type: "noul", noul: 0 },
            },
            provider: "jev",
            model: "jev",
            latencyMs: 1,
            decisionId: "dec_guess",
          };
        }
        if (req.questions.goal_met) {
          return {
            answers: {
              goal_met: { type: "choice", choice: "no", confidence: 0.95, probabilities: {} },
            },
            provider: "jev",
            model: "jev",
            latencyMs: 1,
            decisionId: "dec_text",
          };
        }
        return {
          answers: {
            action: {
              type: "choice",
              choice: "wait",
              confidence: 0.95,
              probabilities: { wait: 0.95 },
            },
            is_destructive: { type: "noul", noul: 0.01 },
          },
          provider: "jev",
          model: "jev",
          latencyMs: 1,
          decisionId: "dec_step",
        };
      },
    } as unknown as DecisionService;
    const result = await runFastLoop({ ...base, screen: screen(true), decisionService: service });
    expect(result.status).not.toBe("completed");
  });
});
