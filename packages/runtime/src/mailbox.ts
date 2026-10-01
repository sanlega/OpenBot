import { newId } from "@openbot/contracts";
import type {
  Clock,
  EngineDriver,
  EngineEvent,
  EngineId,
  MessageKind,
  ToolApprovalRequest,
  Turn,
  TurnHandle,
  TurnHooks,
  TurnInput,
} from "@openbot/contracts";
import type { MessageStore } from "./message-store.js";
import type { SessionStore } from "./session-store.js";
import type { BrokerRequest } from "./broker-types.js";
import type { PermissionBroker } from "./broker.js";
import type { SpendCaps } from "./caps.js";
import type { ChainManager } from "./chain.js";
import type { DeliveryService } from "./delivery.js";
import type { EventSink } from "./event-sink.js";
import type { TurnStore } from "./turn-store.js";
import { classifyToolCall } from "./tool-classifier.js";
import {
  DEFAULT_STALL_WATCH,
  STALL_RESUME_REMINDER,
  StallWatch,
  type StallWatchOptions,
} from "./stall-watch.js";
import { loopReminder, ToolLoopDetector, type LoopDetection } from "./tool-loop-detector.js";
import { refusalMessage } from "./broker.js";

export interface EnqueueTurnInput extends TurnInput {
  engine: EngineId;
  chainId: string;
  /** The Bot's own DM thread, for its direct reply (never gated — see `packages/runtime` module docs). */
  threadId: string;
  spendLimits?: { dailyUsdPerBot?: number; dailyUsdGlobal?: number };
  /** Overrides the default tool -> `BrokerRequest` classification, for tests/callers that know more about a specific tool (e.g. a computer action's observed target label). */
  classifyApproval?: (r: ToolApprovalRequest) => Partial<BrokerRequest>;
  /**
   * Called once the turn id exists and before the engine starts, for inputs that
   * depend on it — e.g. the OpenBot MCP server, whose session token names the turn.
   */
  prepareTurn?: (turnId: string) => Promise<Partial<Pick<TurnInput, "mcpServers">>>;
  /** Called when the turn is over, however it ended: clean up whatever `prepareTurn` set up. */
  finishTurn?: (turnId: string) => void | Promise<void>;
  /** Per-run cap (routine runs): the turn is interrupted once its chain's usage exceeds it. */
  runBudget?: { usd?: number; tokens?: number };
}

export interface TurnOutcome {
  status: "completed" | "failed" | "interrupted" | "refused";
  turnId?: string;
  sessionId?: string;
  text?: string;
  reason?: string;
  /** `text` is the harness's stand-in for a turn that returned none. */
  synthesized?: boolean;
}

interface QueuedTurn {
  input: EnqueueTurnInput;
  resolve: (outcome: TurnOutcome) => void;
  queuedAt: string;
}

interface ActiveTurn {
  handle: TurnHandle;
  turnId: string;
}

export interface MailboxOptions {
  drivers: Partial<Record<EngineId, EngineDriver>>;
  broker: PermissionBroker;
  chains: ChainManager;
  delivery: DeliveryService;
  events: EventSink;
  turns: TurnStore;
  spendCaps?: SpendCaps;
  clock: Clock;
  /** When set, the Bot's direct reply is persisted to its DM thread. */
  messages?: MessageStore;
  /** When set, a turn without an explicit `sessionId` resumes the Bot's last engine session. */
  sessions?: SessionStore;
  /** C8: how long a quiet engine may run before it is stopped and resumed once; `false` turns it off. */
  stallWatch?: Partial<StallWatchOptions> | false;
  /** C1: records loops in the engine's own tool calls. */
  onToolLoop?: (detection: LoopDetection) => void;
  /**
   * K3: what happens on a loop in the engine's own tools: `on` (default) steers a loop reminder
   * into the turn, `shadow` only records it, `off` does nothing.
   */
  nativeToolLoops?: "off" | "shadow" | "on";
}

const NO_REPLY_RE = /^NO_REPLY[.!]?$/i;
const MESSAGE_USER_TOOL = "message_user";
const SEND_MESSAGE_TOOL = "send_message";

function defaultClassify(r: ToolApprovalRequest, workspaceDir?: string): Partial<BrokerRequest> {
  return classifyToolCall(r.toolName, r.input, workspaceDir);
}

/**
 * The mailbox (plan §5 WS2 "Mailbox and delivery"): one active turn per Bot,
 * FIFO-queued, with user-driven steer/interrupt/stop. Wires `EngineDriver`'s
 * `TurnHooks` to the rest of the runtime: `emit()` fans out into `OBEvent`s
 * and chain/usage bookkeeping; `requestApproval()` routes through the
 * {@link PermissionBroker}. `message_user`/`send_message` tool calls are
 * recognized specially and routed through `DeliveryService` (which already
 * knows how to gate `dry_run` chains for those two tools per plan §5 WS2).
 */
export class Mailbox {
  private readonly queues = new Map<string, QueuedTurn[]>();
  private readonly active = new Map<string, ActiveTurn>();
  /** Tool calls in flight, by tool-use id (for the loop detector). */
  private readonly toolCalls = new Map<string, { name: string; input: unknown }>();
  private readonly nativeLoops: ToolLoopDetector | undefined;

  constructor(private readonly opts: MailboxOptions) {
    const mode = opts.nativeToolLoops ?? "on";
    this.nativeLoops = mode === "off" ? undefined : new ToolLoopDetector(mode, opts.onToolLoop);
  }

  /**
   * Says something to the engine inside its running turn (K1, K3). Only engines that take text
   * mid-turn (Claude, Codex); for the others, a queued prompt would start a new exchange.
   */
  private nudge(botId: string, engine: EngineId, text: string): void {
    const driver = this.opts.drivers[engine];
    const live =
      driver?.describe?.().capabilities.steer ??
      (engine === "claude" || engine === "codex" || engine === "fake");
    if (!live) return;
    const active = this.active.get(botId);
    if (!active) return;
    // After the engine has its answer to the current call, not in the middle of it.
    setTimeout(() => void active.handle.steer(text).catch(() => undefined), 0);
  }

  submit(input: EnqueueTurnInput): Promise<TurnOutcome> {
    return new Promise((resolve) => {
      const queue = this.queues.get(input.bot.id) ?? [];
      queue.push({ input, resolve, queuedAt: this.opts.clock.now().toISOString() });
      this.queues.set(input.bot.id, queue);
      this.pump(input.bot.id);
    });
  }

  isBusy(botId: string): boolean {
    return this.active.has(botId);
  }

  queueLength(botId: string): number {
    return this.queues.get(botId)?.length ?? 0;
  }

  async steer(botId: string, text: string): Promise<void> {
    const active = this.active.get(botId);
    if (!active) throw new Error(`Mailbox: no active turn for bot ${botId}`);
    await active.handle.steer(text);
  }

  async interrupt(botId: string): Promise<void> {
    const active = this.active.get(botId);
    if (!active) return;
    await active.handle.interrupt();
  }

  /** Interrupts the active turn (if any) and drains — refuses — every queued turn for this Bot. */
  async stop(botId: string): Promise<void> {
    await this.interrupt(botId);
    const queue = this.queues.get(botId) ?? [];
    this.queues.set(botId, []);
    for (const item of queue) item.resolve({ status: "refused", reason: "stopped" });
  }

  private pump(botId: string): void {
    if (this.active.has(botId)) return;
    const queue = this.queues.get(botId);
    const next = queue?.shift();
    if (!next) return;
    void this.runTurn(botId, next);
  }

  private async runTurn(botId: string, item: QueuedTurn): Promise<void> {
    const { input, resolve } = item;

    const chainHit = this.opts.chains.recordTurnStarted(input.chainId);
    const chain = this.opts.chains.get(input.chainId);
    if (chain.status !== "active" || chainHit) {
      resolve({ status: "refused", reason: `chain is ${chain.status}` });
      this.pump(botId);
      return;
    }

    const driver = this.opts.drivers[input.engine];
    if (!driver) {
      resolve({
        status: "refused",
        reason: `no EngineDriver registered for engine "${input.engine}"`,
      });
      this.pump(botId);
      return;
    }

    if (input.spendLimits) {
      const spendCheck = await this.opts.spendCaps?.checkBeforeTurn({
        botId,
        chainId: input.chainId,
        ...input.spendLimits,
      });
      if (spendCheck && !spendCheck.allowed) {
        resolve({ status: "refused", reason: spendCheck.reason });
        this.pump(botId);
        return;
      }
    }

    const storedSessionId = input.sessionId
      ? undefined
      : this.opts.sessions?.get(botId, input.engine);
    const sessionId = input.sessionId ?? storedSessionId;
    const turnId = newId("turn");
    const startedAt = this.opts.clock.now().toISOString();
    this.opts.turns.create({
      id: turnId,
      botId,
      chainId: input.chainId,
      engine: input.engine,
      model: input.model,
      effort: input.effort,
      sessionId,
    });
    this.opts.events.emit({
      ts: startedAt,
      type: "turn.started",
      botId,
      chainId: input.chainId,
      turnId,
      payload: { engine: input.engine, model: input.model },
    });
    // C10: when each stage happened, to see what makes a first answer slow.
    const mark = (marks: NonNullable<Turn["latency"]>) => {
      try {
        this.opts.turns.markLatency?.(turnId, marks);
      } catch {
        // Measurements never break a turn.
      }
    };
    const nowIso = () => this.opts.clock.now().toISOString();
    mark({ queuedAt: item.queuedAt });
    // What this turn used (engines report per-turn totals or deltas; either way they add up).
    const turnUsage = { inputTokens: 0, outputTokens: 0, usd: 0, cacheReadTokens: 0 };
    let sawDelta = false;
    let sawTool = false;

    let turnInput: TurnInput = { ...input, sessionId };
    if (input.prepareTurn) {
      try {
        turnInput = { ...turnInput, ...(await input.prepareTurn(turnId)) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.opts.turns.update(turnId, { status: "failed" });
        this.opts.events.emit({
          ts: this.opts.clock.now().toISOString(),
          type: "turn.failed",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { errorMessage: reason },
        });
        await this.finish(input, turnId);
        resolve({ status: "failed", turnId, reason });
        this.pump(botId);
        return;
      }
    }

    // The reply is what the engine wrote after its last tool call; what it said between tools
    // ("Let me open the page…") is narration, shown live in the turn's activity, not the answer.
    let replyText = "";
    let lastSaid = "";
    let toolCallCount = 0;
    const pendingToolEffects: Promise<void>[] = [];

    const watchOptions =
      this.opts.stallWatch === false
        ? undefined
        : { ...DEFAULT_STALL_WATCH, ...(this.opts.stallWatch ?? {}) };

    let result!: Awaited<ReturnType<typeof driver.startTurn>["done"]>;
    let attemptInput = turnInput;
    for (let attempt = 1; ; attempt += 1) {
      let stalled = false;
      let handle: TurnHandle | undefined;
      const watch = watchOptions
        ? new StallWatch(watchOptions, () => {
            stalled = true;
            void handle?.interrupt();
          })
        : undefined;
      const hooks: TurnHooks = {
        emit: (e: EngineEvent) => {
          watch?.activity(e as { type: string; toolUseId?: string });
          if (e.type === "usage") {
            turnUsage.inputTokens += e.inputTokens;
            turnUsage.outputTokens += e.outputTokens;
            turnUsage.usd += e.usd ?? 0;
            turnUsage.cacheReadTokens += e.cacheReadTokens ?? 0;
          }
          if (e.type === "text_delta" && !sawDelta) {
            sawDelta = true;
            mark({ firstDeltaAt: nowIso() });
          } else if (e.type === "tool_started" && !sawTool) {
            sawTool = true;
            mark({ firstToolAt: nowIso() });
          }
          if (e.type === "tool_started") {
            toolCallCount += 1;
            if (replyText.trim()) lastSaid = replyText;
            replyText = "";
          }
          this.handleEngineEvent({ botId, input, turnId, event: e, pendingToolEffects }, (t) => {
            replyText += t;
          });
        },
        requestApproval: (r: ToolApprovalRequest) =>
          watch
            ? watch.whileWaitingOnUser(() => this.handleApprovalRequest(botId, input, r))
            : this.handleApprovalRequest(botId, input, r),
      };
      try {
        if (attempt === 1) mark({ engineStartedAt: nowIso() });
        handle = driver.startTurn(attemptInput, hooks);
        const active: ActiveTurn = { handle, turnId };
        this.active.set(botId, active);
        watch?.start();
        result = await active.handle.done;
      } catch (error) {
        // An engine that throws (bad model, lost process, RPC error) fails this
        // turn; it must never leave the Bot's queue stuck behind it.
        result = {
          sessionId: attemptInput.sessionId ?? "",
          isError: true,
          errorMessage: error instanceof Error ? error.message : String(error),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      } finally {
        watch?.stop();
        this.active.delete(botId);
      }
      if (!stalled) break;
      const minutes = Math.round((watchOptions?.quietMs ?? 0) / 60_000);
      if (attempt >= 2) {
        // Stalled again after a resume: say so plainly instead of hanging the Bot's queue.
        result = {
          ...result,
          isError: true,
          errorMessage: `engine_stalled: the engine made no progress for about ${minutes} minutes, twice; try again or switch engines`,
        };
        break;
      }
      this.opts.events.emit({
        ts: this.opts.clock.now().toISOString(),
        type: "error",
        botId,
        chainId: input.chainId,
        turnId,
        payload: {
          message: `The engine made no progress for about ${minutes} minutes; OpenBot stopped it and is resuming once.`,
          authFailure: false,
        },
      });
      // Resume the same engine session with a reminder; without a session, start over.
      const resumeId = result.sessionId || attemptInput.sessionId;
      attemptInput = {
        ...turnInput,
        sessionId: resumeId || undefined,
        text: resumeId ? STALL_RESUME_REMINDER : `${STALL_RESUME_REMINDER}\n\n${turnInput.text}`,
        attachments: resumeId ? [] : turnInput.attachments,
      };
    }
    await this.finish(input, turnId);
    this.opts.broker.abandonFor(botId, input.chainId);
    await Promise.all(pendingToolEffects);
    mark({ completedAt: nowIso() });

    const status = result.isError
      ? result.errorMessage === "interrupted"
        ? "interrupted"
        : "failed"
      : "completed";
    this.opts.turns.update(turnId, {
      status,
      sessionId: result.sessionId,
      usage: {
        inputTokens: turnUsage.inputTokens,
        outputTokens: turnUsage.outputTokens,
        usd: turnUsage.usd,
        ...(turnUsage.cacheReadTokens > 0 ? { cacheReadTokens: turnUsage.cacheReadTokens } : {}),
      },
    });
    if (status === "completed" && result.sessionId) {
      this.opts.sessions?.set(botId, input.engine, result.sessionId);
    } else if (status === "failed" && storedSessionId) {
      // Don't keep resuming a session the engine just failed on.
      this.opts.sessions?.clear(botId, input.engine);
    }
    // A reply of exactly NO_REPLY means "nothing to add" (a harness update the user already saw).
    let synthesized = false;
    // Ended on a tool call with nothing after it: its last words are the answer.
    if (status === "completed" && !replyText.trim()) replyText = lastSaid;
    if (status === "completed") replyText = replyText.trim();
    if (status === "completed" && NO_REPLY_RE.test(replyText)) replyText = "";
    // Local models often open their answer with blank lines (or reply with nothing else).
    else if (status === "completed" && replyText.trim().length === 0) {
      synthesized = true;
      // The engine can end a turn on a tool call with no closing text (seen with
      // Codex/gpt-5.5 on multi-step tasks) — without this, the turn is silently
      // dropped: no message, no error, nothing the user can see went wrong.
      replyText =
        toolCallCount > 0
          ? `Finished ${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"} but didn't return a summary — check Activity for what it did.`
          : "Finished without returning any text.";
    }
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type:
        status === "completed"
          ? "turn.completed"
          : status === "interrupted"
            ? "turn.interrupted"
            : "turn.failed",
      botId,
      chainId: input.chainId,
      turnId,
      payload: { text: replyText, errorMessage: result.errorMessage },
    });

    if (status === "completed" && replyText.length > 0) {
      // A dry-run chain has zero side effects, including the Bot's thread.
      const message =
        chain.mode === "dry_run"
          ? undefined
          : this.opts.messages?.create({
              threadId: input.threadId,
              author: { type: "bot", id: botId },
              text: replyText,
              attachments: [],
              chainId: input.chainId,
              hop: 0,
              proactive: false,
              delivery: "delivered",
              pushed: false,
            });
      this.opts.events.emit({
        ts: message?.createdAt ?? this.opts.clock.now().toISOString(),
        type: "message.created",
        botId,
        threadId: input.threadId,
        chainId: input.chainId,
        turnId,
        payload: { text: replyText, proactive: false, messageId: message?.id },
      });
    }

    resolve({
      status,
      turnId,
      sessionId: result.sessionId,
      text: replyText,
      reason: result.errorMessage,
      synthesized,
    });
    this.pump(botId);
  }

  private handleEngineEvent(
    ctx: {
      botId: string;
      input: EnqueueTurnInput;
      turnId: string;
      event: EngineEvent;
      pendingToolEffects: Promise<void>[];
    },
    onText: (text: string) => void,
  ): void {
    const { botId, input, turnId, event } = ctx;
    const now = this.opts.clock.now().toISOString();
    switch (event.type) {
      case "session_started":
        this.opts.turns.update(turnId, { sessionId: event.sessionId });
        return;
      case "text_delta":
        onText(event.text);
        this.opts.events.emit({
          ts: now,
          type: "message.delta",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { text: event.text },
        });
        return;
      case "tool_started":
        this.opts.events.emit({
          ts: now,
          type: "tool.started",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { toolName: event.toolName, toolUseId: event.toolUseId, input: event.input },
        });
        if (event.toolName === MESSAGE_USER_TOOL || event.toolName === SEND_MESSAGE_TOOL) {
          ctx.pendingToolEffects.push(this.deliverTool(botId, input, event));
        }
        this.toolCalls.set(event.toolUseId, { name: event.toolName, input: event.input });
        return;
      case "tool_completed": {
        this.opts.events.emit({
          ts: now,
          type: "tool.completed",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { toolUseId: event.toolUseId, output: event.output, isError: event.isError },
        });
        const call = this.toolCalls.get(event.toolUseId);
        this.toolCalls.delete(event.toolUseId);
        // The engine's own tools (shell, files) are watched in shadow: recorded, never acted on.
        // OpenBot's tools are watched (and answered) by the MCP server itself.
        if (call && this.nativeLoops && !call.name.startsWith("mcp__openbot")) {
          const output =
            typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? null);
          const action = this.nativeLoops.observe(turnId, call.name, call.input, output, botId);
          if (action !== "none") {
            this.nudge(botId, input.engine, loopReminder(action, action === "retry_once" ? 2 : 3));
          }
        }
        return;
      }
      case "usage": {
        const usd = event.usd ?? 0;
        const tokens = event.inputTokens + event.outputTokens;
        this.opts.chains.recordUsage(input.chainId, { usd, tokens });
        if (input.runBudget) {
          const chain = this.opts.chains.get(input.chainId);
          const overUsd = input.runBudget.usd !== undefined && chain.usd > input.runBudget.usd;
          const overTokens =
            input.runBudget.tokens !== undefined && chain.tokens > input.runBudget.tokens;
          if (overUsd || overTokens) void this.interrupt(botId);
        }
        if (this.opts.spendCaps && input.spendLimits) {
          void this.opts.spendCaps
            .recordUsage({ botId, chainId: input.chainId, usd, tokens, ...input.spendLimits })
            .then((r) => {
              if (!r.allowed) void this.interrupt(botId);
            });
        }
        return;
      }
      case "error":
        this.opts.events.emit({
          ts: now,
          type: "error",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { message: event.message, authFailure: event.authFailure ?? false },
        });
        return;
    }
  }

  private async deliverTool(
    botId: string,
    input: EnqueueTurnInput,
    event: { toolName: string; input: unknown },
  ): Promise<void> {
    const args = (event.input ?? {}) as Record<string, unknown>;
    const mode = this.opts.chains.get(input.chainId).mode;
    if (event.toolName === MESSAGE_USER_TOOL) {
      await this.opts.delivery.sendBotToUser({
        chainId: input.chainId,
        botId,
        threadId: input.threadId,
        kind: (args.kind as MessageKind) ?? "result",
        text: String(args.body ?? args.text ?? ""),
        options: Array.isArray(args.options) ? (args.options as string[]) : undefined,
        deadline: typeof args.deadline === "string" ? args.deadline : undefined,
        dedupeKey: typeof args.dedupe_key === "string" ? args.dedupe_key : undefined,
        mode,
      });
      return;
    }
    // send_message
    await this.opts.delivery.sendBotToBot({
      chainId: input.chainId,
      fromBotId: botId,
      toBotId: String(args.bot ?? ""),
      toThreadId: typeof args.toThreadId === "string" ? args.toThreadId : String(args.bot ?? ""),
      text: String(args.text ?? ""),
      mode,
    });
  }

  /** Runs the caller's cleanup; whatever it does, it must never stall the Bot's queue. */
  private async finish(input: EnqueueTurnInput, turnId: string): Promise<void> {
    try {
      await input.finishTurn?.(turnId);
    } catch {
      // Cleanup only.
    }
  }

  private async handleApprovalRequest(
    botId: string,
    input: EnqueueTurnInput,
    r: ToolApprovalRequest,
  ): Promise<"allow" | "deny"> {
    // OpenBot's own tools carry their own gates (spawn/notify gates, caps, dry-run simulation); the
    // engine must not put a card in front of the user for them (Claude gets the same via allowTools).
    if (input.allowTools.some((p) => r.toolName === p || r.toolName.startsWith(`${p}__`))) {
      return "allow";
    }
    const classified = {
      ...defaultClassify(r, input.cwd),
      ...(input.classifyApproval?.(r) ?? {}),
    };
    const req: BrokerRequest = {
      botId,
      chainId: input.chainId,
      kind: classified.kind ?? "tool",
      action: classified.action ?? r.toolName,
      target: classified.target,
      sideEffect: classified.sideEffect,
      readOnly: classified.readOnly,
      inWorkspace: classified.inWorkspace,
      computerAccess: input.bot.computer,
      ...(classified.vmBrowser ? { vmBrowser: true } : {}),
      args: classified.args ?? ((r.input ?? {}) as Record<string, unknown>),
      summary: classified.summary ?? `${r.toolName} requested by ${botId}`,
      detail: classified.detail ?? JSON.stringify(r.input ?? {}),
    };
    const decision = await this.opts.broker.evaluate(req, {
      mode: this.opts.chains.get(input.chainId).mode,
      preset: input.permission,
    });
    if (decision.outcome === "allow") return "allow";
    // A simulated action is recorded (`action.simulated`) and must not run: the
    // engine executes whatever it is allowed to, so refuse it.
    if (decision.outcome === "simulate") return "deny";
    if (decision.outcome === "deny") {
      // K1: the engine's own refusal says nothing about detours; tell it in words.
      this.nudge(botId, input.engine, refusalMessage("blocked", decision.reason));
      return "deny";
    }
    const answer = await this.opts.broker.waitForApproval(decision.approvalId as string);
    if (answer === "deny" && this.active.has(botId)) {
      const card = this.opts.broker.approval?.(decision.approvalId as string);
      const expired = card?.resolution === "expired";
      this.nudge(botId, input.engine, refusalMessage(expired ? "expired" : "declined"));
    }
    return answer;
  }
}
