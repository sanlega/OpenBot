import type { TurnHooks, TurnInput } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import type { CodexAppServer } from "./app-server.js";
import { CodexDriver } from "./driver.js";

/** An app-server that only knows the threads it started or resumed itself, like a fresh process. */
function fakeAppServer(options: { knows?: string[]; canResume?: boolean } = {}) {
  const known = new Set(options.knows ?? []);
  const calls: string[] = [];
  const server = {
    threadStart: async () => {
      calls.push("start");
      known.add("fresh-thread");
      return "fresh-thread";
    },
    threadResume: async (id: string) => {
      calls.push(`resume:${id}`);
      if (options.canResume === false || !known.has(id)) {
        throw new Error(`thread not found: ${id}`);
      }
      return id;
    },
    turnStart: async (id: string) => {
      calls.push(`turn:${id}`);
      if (!known.has(id)) throw new Error(`thread not found: ${id}`);
      return "turn-1";
    },
    listMcpServerStatus: async () => ({ data: [] }),
    watchTurn: (state: { turnComplete?: boolean; text?: string }) => {
      // The turn finishes as soon as it starts.
      queueMicrotask(() => {
        state.text = "ok";
        state.turnComplete = true;
      });
      return () => undefined;
    },
    turnInterrupt: async () => undefined,
    turnSteer: async () => undefined,
  };
  return { server: server as unknown as CodexAppServer, calls, known };
}

function input(sessionId?: string): TurnInput {
  return { bot: { id: "bot_1" }, text: "hi", sessionId } as unknown as TurnInput;
}

async function run(driver: CodexDriver, turn: TurnInput) {
  const sessions: string[] = [];
  const hooks = {
    emit: (event: { type: string; sessionId?: string }) => {
      if (event.type === "session_started" && event.sessionId) sessions.push(event.sessionId);
    },
  } as unknown as TurnHooks;
  const result = await driver.startTurn(turn, hooks).done;
  return { result, sessions };
}

describe("CodexDriver threads", () => {
  it("resumes a stored session before using it, since the app-server may have restarted", async () => {
    const { server, calls } = fakeAppServer({ knows: ["old-thread"] });
    const { sessions } = await run(new CodexDriver({ appServer: server }), input("old-thread"));
    expect(calls.slice(0, 2)).toEqual(["resume:old-thread", "turn:old-thread"]);
    expect(sessions).toEqual(["old-thread"]);
  });

  it("starts a fresh thread when Codex no longer has the stored one", async () => {
    const { server, calls } = fakeAppServer({ knows: [] });
    const { result, sessions } = await run(
      new CodexDriver({ appServer: server }),
      input("gone-thread"),
    );
    expect(calls).toEqual(["resume:gone-thread", "start", "turn:fresh-thread"]);
    expect(sessions).toEqual(["fresh-thread"]);
    expect(result.isError).toBeFalsy();
  });

  it("recovers when the thread vanishes between resume and the turn", async () => {
    const { server, calls, known } = fakeAppServer({ knows: ["flaky"] });
    const original = server.threadResume.bind(server);
    // Resume succeeds, then the app-server restarts and forgets the thread.
    server.threadResume = async (id: string) => {
      const resumed = await original(id);
      known.delete(id);
      return resumed;
    };
    const { sessions } = await run(new CodexDriver({ appServer: server }), input("flaky"));
    expect(calls).toContain("start");
    expect(sessions).toEqual(["flaky", "fresh-thread"]);
  });
});
