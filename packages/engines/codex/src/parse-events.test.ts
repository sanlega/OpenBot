import type { EngineEvent } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import type { CodexJsonRpcNotification } from "./generated/protocol.js";
import { createCodexParseState, handleCodexNotification } from "./parse-events.js";

/** Notifications as `codex app-server` 0.155.0 sends them (captured from a real turn, trimmed). */
const THREAD = "01a0ee35-0d6a-7c22-8534-964f5fdc51e3";
const note = (method: string, params: Record<string, unknown>): CodexJsonRpcNotification =>
  ({ jsonrpc: "2.0", method, params }) as CodexJsonRpcNotification;

const REAL_TURN: CodexJsonRpcNotification[] = [
  note("item/started", { threadId: THREAD, item: { type: "userMessage", id: "u1", content: [] } }),
  note("item/started", {
    threadId: THREAD,
    item: { type: "agentMessage", id: "m1", text: "", phase: "commentary" },
  }),
  ...["I", "’ll", " run", " the", " command", " now", ".\n"].map((delta) =>
    note("item/agentMessage/delta", { threadId: THREAD, itemId: "m1", delta }),
  ),
  note("item/completed", {
    threadId: THREAD,
    item: {
      type: "agentMessage",
      id: "m1",
      text: "I’ll run the command now.\n",
      phase: "commentary",
    },
  }),
  note("item/started", {
    threadId: THREAD,
    item: { type: "commandExecution", id: "exec-1", command: "echo hello", status: "inProgress" },
  }),
  note("item/completed", {
    threadId: THREAD,
    item: {
      type: "commandExecution",
      id: "exec-1",
      command: "echo hello",
      status: "completed",
      aggregatedOutput: "hello\r\n",
      exitCode: 0,
    },
  }),
  note("item/started", {
    threadId: THREAD,
    item: { type: "agentMessage", id: "m2", text: "", phase: "final_answer" },
  }),
  ...["The", " command", " printed", " hello", "."].map((delta) =>
    note("item/agentMessage/delta", { threadId: THREAD, itemId: "m2", delta }),
  ),
  note("item/completed", {
    threadId: THREAD,
    item: {
      type: "agentMessage",
      id: "m2",
      text: "The command printed hello.",
      phase: "final_answer",
    },
  }),
  note("turn/completed", {
    threadId: THREAD,
    turn: {
      id: "t1",
      status: "completed",
      error: null,
      items: [{ type: "agentMessage", id: "m2", text: "The command printed hello." }],
    },
  }),
];

function run(notifications: CodexJsonRpcNotification[], threadId: string | undefined = THREAD) {
  const state = createCodexParseState();
  state.threadId = threadId;
  const events: EngineEvent[] = [];
  for (const n of notifications) handleCodexNotification(n, state, { emit: (e) => events.push(e) });
  return { state, events };
}

describe("handleCodexNotification with the current Codex CLI", () => {
  it("collects the streamed reply text (regression: every Codex turn came back empty)", () => {
    const { state, events } = run(REAL_TURN);
    expect(state.text).toBe("I’ll run the command now.\nThe command printed hello.");
    expect(
      events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe(state.text);
    expect(state.turnComplete).toBe(true);
    expect(state.isError).toBe(false);
  });

  it("reports the command as a tool call, started then completed", () => {
    const { events } = run(REAL_TURN);
    const tools = events.filter((e) => e.type === "tool_started" || e.type === "tool_completed");
    expect(tools).toEqual([
      {
        type: "tool_started",
        toolName: "shell",
        input: { command: "echo hello" },
        toolUseId: "exec-1",
      },
      { type: "tool_completed", toolUseId: "exec-1", output: "hello\r\n", isError: false },
    ]);
  });

  it("marks a failing command as an error", () => {
    const { events } = run([
      note("item/completed", {
        threadId: THREAD,
        item: {
          type: "commandExecution",
          id: "e2",
          command: "false",
          status: "completed",
          exitCode: 1,
        },
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_completed", isError: true }),
    );
  });

  it("names MCP tool calls like every other engine does", () => {
    const { events } = run([
      note("item/started", {
        threadId: THREAD,
        item: {
          type: "mcpToolCall",
          id: "c1",
          server: "openbot",
          tool: "create_bot",
          arguments: { name: "X" },
        },
      }),
    ]);
    expect(events).toContainEqual({
      type: "tool_started",
      toolName: "mcp__openbot__create_bot",
      input: { name: "X" },
      toolUseId: "c1",
    });
  });

  it("uses a message's completed text when no deltas streamed, and never repeats streamed text", () => {
    const { state } = run([
      note("item/completed", {
        threadId: THREAD,
        item: { type: "agentMessage", id: "m9", text: "Only in the completed item." },
      }),
    ]);
    expect(state.text).toBe("Only in the completed item.");
  });

  it("falls back to the turn's final messages when nothing else carried text", () => {
    const { state } = run([
      note("turn/completed", {
        threadId: THREAD,
        turn: { status: "completed", items: [{ type: "agentMessage", id: "m", text: "Done." }] },
      }),
    ]);
    expect(state.text).toBe("Done.");
  });

  it("still understands the older delta shape (an object with text)", () => {
    const { state } = run([
      note("turn/agentMessage/delta", { delta: { text: "old " } }),
      note("agent/message/delta", { delta: { text: "shape" } }),
    ]);
    expect(state.text).toBe("old shape");
  });

  it("ignores another Bot's thread: its text and its turn end are not ours", () => {
    const other = "01a0ee99-0000-7000-8000-000000000000";
    const { state, events } = run([
      note("item/agentMessage/delta", { threadId: other, itemId: "x", delta: "not mine" }),
      note("item/started", {
        threadId: other,
        item: { type: "commandExecution", id: "e", command: "rm -rf /" },
      }),
      note("turn/completed", { threadId: other, turn: { status: "failed", error: "boom" } }),
    ]);
    expect(state.text).toBe("");
    expect(state.turnComplete).toBe(false);
    expect(state.isError).toBe(false);
    expect(events).toEqual([]);
  });

  it("reports a failed turn with its reason", () => {
    const { state } = run([
      note("turn/completed", {
        threadId: THREAD,
        turn: { status: "failed", error: { message: "model not supported" }, items: [] },
      }),
    ]);
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toBe("model not supported");
  });
});
