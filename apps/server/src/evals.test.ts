import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkExpectations, loadEvalCases, runEvals } from "./evals.js";

const casesDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "evals",
  "cases",
);

describe("openbot eval (C11)", () => {
  it("runs the repository's cases on the fake engine; real and judged ones are skipped", async () => {
    const cases = await loadEvalCases(casesDir);
    expect(cases.length).toBeGreaterThanOrEqual(4);
    const results = await runEvals(cases);
    const ran = results.filter((r) => !r.skipped);
    expect(ran.map((r) => r.id)).toEqual(["plain-request", "openbot-tools"]);
    for (const r of ran) expect(r.reasons, r.id).toEqual([]);
    expect(results.find((r) => r.id === "openbot-tools")?.tools).toContain(
      "mcp__openbot__list_bots",
    );
    expect(results.filter((r) => r.skipped).map((r) => r.id)).toEqual([
      "vm-bot-runs-in-the-vm",
      "answers-in-the-users-language",
    ]);
  }, 60_000);

  it("says exactly which rule a reply broke", () => {
    const reasons = checkExpectations(
      {
        id: "x",
        prompt: "p",
        expect: {
          status: "completed",
          replyIncludes: ["done"],
          replyExcludes: ["sorry"],
          replyMatches: "^ok",
          toolsUsed: ["vm_shell"],
          toolsNotUsed: ["Bash"],
          maxApprovals: 0,
        },
      },
      { reply: "Sorry, failed", tools: ["Bash"], approvals: 2, status: "failed" },
    );
    expect(reasons).toEqual([
      "turn failed, expected completed",
      'reply lacks "done"',
      'reply contains "sorry"',
      "reply doesn't match /^ok/",
      "tool vm_shell not used",
      "tool Bash was used",
      "2 approval cards (at most 0)",
    ]);
  });
});
