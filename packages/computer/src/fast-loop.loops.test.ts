import { describe, expect, it } from "vitest";
import type { Action, DecisionService, Observation, Screen } from "@openbot/contracts";
import { isReadOnlyGoal, runFastLoop } from "./fast-loop.js";

/**
 * The loops seen in the 2026-09-30 logs: 14 scrolls in a row, 38 clicks on one page, "describe
 * this page" tasks that scrolled until the step limit, and pages that never finished opening.
 */

const base = { botId: "bot_1", chainId: "chn_1", providerId: "fake", settleMs: 0 };

function obs(url: string, labels: Array<[string, string]>, text?: string): Observation {
  return {
    url,
    title: url,
    elements: labels.map(([role, label], index) => ({ index, role, label })),
    ...(text ? { text } : {}),
  };
}

/** Jev that always picks the first offered id from `prefer`, with high confidence. */
function stubbornJev(prefer: string[], offered: string[][] = []): DecisionService {
  return {
    decide: async (req: { questions: Record<string, { criteria: Record<string, string> }> }) => {
      const ids = Object.keys(req.questions.action?.criteria ?? { no: "" });
      offered.push(ids);
      const choice =
        prefer.map((p) => ids.find((id) => id === p || id.startsWith(p))).find(Boolean) ?? "done";
      return {
        answers: {
          action: { type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } },
          is_destructive: { type: "noul", noul: 0.02 },
          goal_met: { type: "choice", choice: "no", confidence: 0.9 },
        },
        provider: "jev",
        model: "test",
        latencyMs: 1,
        decisionId: "dec_1",
      };
    },
  } as unknown as DecisionService;
}

function screenOf(
  observe: () => Observation,
  act: (action: Action) => Promise<{ ok: boolean; reason?: string }> = async () => ({ ok: true }),
): { screen: Screen; acts: Action[] } {
  const acts: Action[] = [];
  return {
    acts,
    screen: {
      observe: async () => observe(),
      act: async (action) => {
        acts.push(action);
        return act(action);
      },
      liveView: async () => ({ url: "", token: "", expiresAt: "" }),
      takeover: async () => undefined,
    },
  };
}

describe("loop guards", () => {
  it("stops offering scroll after a few scrolls on one page (no endless scrolling)", async () => {
    let offset = 0;
    const { screen, acts } = screenOf(
      () =>
        obs("https://ph.test/new", [
          ["link", `Product ${offset}`],
          ["button", "Next"],
        ]),
      async (action) => {
        if (action.op === "scroll") offset += 1;
        return { ok: true };
      },
    );
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService: stubbornJev(["scroll_down", "done"]),
      goal: "Find the submission form for a new product and fill it",
    });
    const scrolls = acts.filter((a) => a.op === "scroll").length;
    expect(scrolls).toBeLessThanOrEqual(6);
    expect(result.steps).toBeLessThan(12);
  });

  it("does not click the same control a third time on the same page", async () => {
    let open = false;
    const { screen, acts } = screenOf(
      () =>
        obs(
          "https://ph.test/welcome",
          open
            ? [
                ["button", "Menu"],
                ["link", "Settings"],
              ]
            : [["button", "Menu"]],
        ),
      async (action) => {
        if (action.op === "click") open = !open;
        return { ok: true };
      },
    );
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService: stubbornJev(["click_0", "scroll_down", "wait"]),
      goal: "Complete the onboarding name field",
    });
    const menuClicks = acts.filter((a) => a.op === "click" && a.target === 0).length;
    expect(menuClicks).toBeLessThanOrEqual(2);
    expect(result.steps).toBeLessThan(25);
  });

  it("gives up with a reason after many steps on one page without progress", async () => {
    let n = 0;
    const { screen } = screenOf(
      // Every click changes something small on the page (a counter), so no state repeats.
      () =>
        obs("https://ph.test/form", [
          ...Array.from({ length: 30 }, (_, i): [string, string] => ["button", `Tab ${i}`]),
          ["status", `Changes ${n}`],
        ]),
      async () => {
        n += 1;
        return { ok: true };
      },
    );
    // Each pick is a different, never repeated button: no single guard but the progress one fires.
    let next = 0;
    const decisionService = {
      decide: async (req: { questions: Record<string, { criteria: Record<string, string> }> }) => {
        const ids = Object.keys(req.questions.action?.criteria ?? {});
        const clicks = ids.filter((id) => id.startsWith("click_"));
        const choice = clicks[next++ % clicks.length] ?? "done";
        return {
          answers: {
            action: { type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } },
            goal_met: { type: "choice", choice: "no", confidence: 0.9 },
          },
          provider: "jev",
          model: "test",
          latencyMs: 1,
          decisionId: "d",
        };
      },
    } as unknown as DecisionService;
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService,
      goal: "Upload the gallery images",
    });
    expect(result.status).toBe("escalated");
    expect(result.summary).toMatch(/circles/);
    expect(n).toBeLessThanOrEqual(17);
  });

  it("finishes a read-only goal at once with the page and its text", async () => {
    const { screen, acts } = screenOf(() =>
      obs("https://x.test/sanlega", [["link", "Post"]], "Terminal tabs are back. 12 likes"),
    );
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService: stubbornJev(["scroll_down"]),
      goal: "Do not click any buttons. Just scroll down and describe every field you can see.",
    });
    expect(result.status).toBe("completed");
    expect(acts).toHaveLength(0);
    expect(result.lastObservation?.text).toContain("Terminal tabs");
  });

  it("opens the URL named in a read-only goal when no startUrl is given", async () => {
    let url = "about:blank";
    const { screen, acts } = screenOf(
      () => obs(url, [["link", "Home"]], "Welcome"),
      async (action) => {
        if (action.op === "navigate" && action.url) url = action.url;
        return { ok: true };
      },
    );
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService: stubbornJev(["done"]),
      goal: "Navigate to https://ph.test/my/welcome and, without clicking anything, describe it",
    });
    expect(acts[0]).toMatchObject({ op: "navigate", url: "https://ph.test/my/welcome" });
    expect(result.lastObservation?.url).toBe("https://ph.test/my/welcome");
  });

  it("carries on when opening the page is slow but the page can be read", async () => {
    const { screen } = screenOf(
      () =>
        obs("https://x.test/compose", [
          ["textbox", "Post text"],
          ["button", "Post"],
        ]),
      async (action) =>
        action.op === "navigate"
          ? { ok: false, reason: "Opening the page took too long." }
          : { ok: true },
    );
    const result = await runFastLoop({
      ...base,
      screen,
      decisionService: stubbornJev(["done"]),
      goal: "Post a tweet",
      startUrl: "https://x.test/compose",
    });
    expect(result.status).toBe("completed");
  });
});

describe("isReadOnlyGoal", () => {
  it.each([
    ["Just load the page and report what's visible.", true],
    ["Scroll back up and report, without clicking anything, whether images are uploaded", true],
    ["Describe every onboarding step shown", true],
    ["Search X for: from:sanlega and report the exact text of every result", false],
    ["Post a new tweet with the exact text provided", false],
    ["Open the compose box and type the text, then stop", false],
  ])("%s → %s", (goal, expected) => {
    expect(isReadOnlyGoal(goal)).toBe(expected);
  });
});
