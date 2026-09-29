import { tmpdir } from "node:os";
import type { EngineEvent, TurnInput } from "@openbot/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { CodexDriver } from "./driver.js";

/**
 * Runs against the real `codex` CLI on this machine (its own login), because Codex changes its
 * app-server protocol between releases and a silent mismatch makes every turn come back empty.
 * Opt in with OPENBOT_E2E_REAL=1; never part of CI.
 */
const live = process.env.OPENBOT_E2E_REAL === "1";

function input(text: string, sessionId?: string): TurnInput {
  return {
    bot: { id: "bot_live", name: "live" },
    text,
    sessionId,
    attachments: [],
    systemPrompt: "Be brief.",
    cwd: tmpdir(),
    addDirs: [],
    auth: { mode: "login", env: {} },
    mcpServers: [],
    permission: "full",
    allowTools: [],
    denyTools: [],
    model: "gpt-5.5",
    limits: { maxSteps: 50 },
  } as unknown as TurnInput;
}

async function runTurn(driver: CodexDriver, turn: TurnInput) {
  const events: EngineEvent[] = [];
  const result = await driver.startTurn(turn, {
    emit: (e) => events.push(e),
    requestApproval: async () => "allow",
  }).done;
  const text = events
    .filter((e): e is Extract<EngineEvent, { type: "text_delta" }> => e.type === "text_delta")
    .map((e) => e.text)
    .join("");
  return { events, result, text };
}

describe.skipIf(!live)("Codex driver against the real CLI", () => {
  const driver = new CodexDriver();
  afterAll(() => driver.dispose());

  it("returns the reply text and reports a shell command as a tool call", async () => {
    const { events, result, text } = await runTurn(
      driver,
      input("Run the shell command `echo hello-live` and tell me what it printed in one sentence."),
    );
    expect(result.isError).toBe(false);
    expect(text.toLowerCase()).toContain("hello-live");
    expect(events.some((e) => e.type === "tool_started")).toBe(true);
    expect(events.some((e) => e.type === "tool_completed")).toBe(true);
  }, 120_000);
});
