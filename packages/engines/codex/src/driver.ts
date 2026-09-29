import type {
  EngineDriver,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
} from "@openbot/contracts";
import { loadFixture, validateOpenAiKey, waitForTurnComplete } from "@openbot/engines-common";
import { CodexAppServer, FixtureCodexAppServer } from "./app-server.js";
import { detectCodex } from "./detect.js";
import { CODEX_MODELS } from "./models.js";
import { createCodexParseState, toCodexTurnResult } from "./parse-events.js";

let sharedAppServer: CodexAppServer | null = null;

export interface CodexDriverOptions {
  appServer?: CodexAppServer | FixtureCodexAppServer;
  fixtureReplay?: string;
}

/**
 * One shared `codex app-server` with per-thread MCP via `thread/start` (plan §5 WS3).
 */
export class CodexDriver implements EngineDriver {
  readonly id = "codex";

  private readonly appServer: CodexAppServer | FixtureCodexAppServer;
  private readonly threadByBot = new Map<string, string>();
  private disposed = false;

  constructor(options: CodexDriverOptions = {}) {
    if (options.appServer) {
      this.appServer = options.appServer;
    } else if (options.fixtureReplay) {
      this.appServer = new FixtureCodexAppServer(options.fixtureReplay, loadFixture);
    } else {
      if (!sharedAppServer) {
        sharedAppServer = new CodexAppServer();
      }
      this.appServer = sharedAppServer;
    }
  }

  async detect(): Promise<EngineStatus> {
    return detectCodex();
  }

  async validateKey(key: string): Promise<{ ok: boolean; reason?: string }> {
    return validateOpenAiKey(key);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      // Discovery must never hold up a chat turn or the model picker.
      const models = await Promise.race([
        this.appServer.listModels(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("model/list timed out")), 5_000),
        ),
      ]);
      const visible = models.flatMap((entry): ModelInfo[] => {
        if (!entry || typeof entry !== "object") return [];
        const model = entry as { id?: unknown; model?: unknown; displayName?: unknown };
        const id = typeof model.id === "string" ? model.id : model.model;
        if (typeof id !== "string" || id.length === 0) return [];
        return [{ id, label: typeof model.displayName === "string" ? model.displayName : id }];
      });
      return visible.length > 0 ? visible : CODEX_MODELS;
    } catch {
      // Older app-server versions may not expose the experimental model/list method.
      return CODEX_MODELS;
    }
  }

  /** Threads this app-server process knows about; a stored session id may predate it. */
  private readonly liveThreads = new Set<string>();

  private async startFreshThread(input: TurnInput): Promise<string> {
    const id = await this.appServer.threadStart(input);
    this.liveThreads.add(id);
    return id;
  }

  /**
   * The thread to run this turn on. A stored session id only exists in the app-server that
   * created it, so after a restart it must be resumed (and if Codex no longer has it, replaced).
   */
  private async ensureThread(input: TurnInput): Promise<string> {
    const wanted = input.sessionId ?? this.threadByBot.get(input.bot.id);
    if (wanted && this.liveThreads.has(wanted)) return wanted;
    if (wanted) {
      try {
        const id = await this.appServer.threadResume(wanted);
        this.liveThreads.add(id);
        return id;
      } catch (error) {
        if (!isThreadNotFound(error)) throw error;
      }
    }
    return this.startFreshThread(input);
  }

  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    const botKey = input.bot.id;
    let interrupted = false;
    const state = createCodexParseState();

    const done = (async () => {
      let threadId = await this.ensureThread(input);
      this.threadByBot.set(botKey, threadId);

      state.threadId = threadId;
      state.sessionId = threadId;
      hooks.emit({ type: "session_started", sessionId: threadId });

      let lastActivityAt = Date.now();
      const unsubscribe = this.appServer.watchTurn(state, {
        ...hooks,
        emit: (event) => {
          lastActivityAt = Date.now();
          hooks.emit(event);
        },
      });
      let turnId: string;
      try {
        try {
          turnId = await this.appServer.turnStart(threadId, input.text);
        } catch (error) {
          // The app-server forgot this thread (it restarted): start a fresh one and go on.
          if (!isThreadNotFound(error)) throw error;
          this.liveThreads.delete(threadId);
          threadId = await this.startFreshThread(input);
          this.threadByBot.set(botKey, threadId);
          state.threadId = threadId;
          state.sessionId = threadId;
          hooks.emit({ type: "session_started", sessionId: threadId });
          turnId = await this.appServer.turnStart(threadId, input.text);
        }
      } catch (error) {
        unsubscribe();
        throw error;
      }
      state.turnId = turnId;

      try {
        await waitForTurnComplete(
          state,
          () => interrupted,
          () => lastActivityAt,
        );
      } finally {
        unsubscribe();
      }

      if (interrupted) {
        await this.appServer.turnInterrupt(threadId, turnId);
        return {
          sessionId: threadId,
          isError: true,
          errorMessage: "interrupted",
          usage: state.usage,
        };
      }

      return toCodexTurnResult(state);
    })();

    return {
      steer: async (text: string) => {
        const threadId = this.threadByBot.get(botKey);
        if (threadId && state.turnId) {
          await this.appServer.turnSteer(threadId, state.turnId, text);
        }
      },
      interrupt: async () => {
        interrupted = true;
        const threadId = this.threadByBot.get(botKey);
        if (threadId && state.turnId) {
          await this.appServer.turnInterrupt(threadId, state.turnId);
        }
      },
      done,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.appServer instanceof FixtureCodexAppServer) {
      await this.appServer.dispose();
    }
    this.threadByBot.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Exposed for MCP isolation tests. */
  get server(): CodexAppServer | FixtureCodexAppServer {
    return this.appServer;
  }
}

export function createFixtureCodexDriver(fixtureReplay: string): CodexDriver {
  return new CodexDriver({ fixtureReplay });
}

export function resetSharedCodexAppServerForTests(): void {
  sharedAppServer = null;
}

function isThreadNotFound(error: unknown): boolean {
  return /thread not found|no rollout found|unknown thread/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
