// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TurnSteps } from "./TurnSteps.js";
import type { TurnActivity } from "../../state/reducer.js";

describe("TurnSteps", () => {
  it("shows the engine error for a failed turn even when no tool steps ran", () => {
    const turn: TurnActivity = {
      id: "turn_failed",
      botId: "bot_1",
      startedAt: "2026-09-27T10:00:00.000Z",
      endedAt: "2026-09-27T10:00:02.000Z",
      status: "failed",
      steps: [],
      text: "",
      errorMessage: "You've hit your session limit · resets at 11:30pm",
    };

    render(<TurnSteps turn={turn} />);

    expect(screen.getByText("Couldn't finish · 2s")).toBeTruthy();
    expect((screen.getByTestId("turn-steps") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("session limit");
  });
});

describe("TurnSteps plan (N3)", () => {
  it("shows the engine's latest plan with its progress", () => {
    const turn: TurnActivity = {
      id: "turn_1",
      botId: "bot_a",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      status: "running",
      text: "",
      steps: [
        {
          id: "s1",
          tool: "TodoWrite",
          status: "done",
          input: { todos: [{ content: "Old plan", status: "pending" }] },
        },
        {
          id: "s2",
          tool: "update_plan",
          status: "done",
          input: {
            todos: [
              { content: "Read the repo", status: "completed" },
              { content: "Fix the bug", status: "in_progress" },
              { content: "Run the tests", status: "pending" },
            ],
          },
        },
      ],
    };
    render(<TurnSteps turn={turn} />);
    expect(screen.getByText(/plan 1\/3/)).toBeTruthy();
    expect(screen.getByText("Plan · 1 of 3 done")).toBeTruthy();
    expect(screen.getByText("Fix the bug")).toBeTruthy();
    expect(screen.queryByText("Old plan")).toBeNull();
  });
});
