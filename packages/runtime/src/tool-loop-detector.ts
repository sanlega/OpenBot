/**
 * C1: a bot alone, in one turn, can spend twenty minutes calling the same tool and getting the
 * same answer, and nothing stops it until the chain's wall clock. This detector compares each
 * call with the previous one of the same turn after normalising what changes on its own (times,
 * durations, ids), Grok Bot style: the same call with the same result twice is a loop (four
 * times for tools that repeat by nature), and the remedy escalates from "retry once" to a loop
 * reminder for the model. In `shadow` mode it only records, to calibrate before acting.
 */
export type LoopMode = "off" | "shadow" | "on";
export type LoopAction = "none" | "retry_once" | "loop_reminder";

export interface LoopDetection {
  turnId: string;
  botId?: string;
  tool: string;
  repetitions: number;
  /** What the detector would do (or did, in `on` mode). */
  action: Exclude<LoopAction, "none">;
  mode: LoopMode;
}

const VOLATILE: Array<[RegExp, string]> = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g, "<ts>"],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "<time>"],
  [/\b\d+(\.\d+)?\s?(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\b/g, "<dur>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b[0-9a-f]{16,}\b/gi, "<hex>"],
  [/\b(id|Id|ID)[:=]\s*"?[\w-]+"?/g, "id:<id>"],
];

/** Tools that repeat by nature (keys, scrolling, waiting, checking a task): 4 repeats, not 2. */
export const TOLERANT_TOOLS = new Set([
  "browser_key",
  "browser_scroll",
  "computer_status",
  "computer_screenshot",
  "get_bot_status",
  "list_bots",
]);

/** A tool saying "try again" invites one retry: that one doesn't count. */
const INVITED_RETRY = /\b(try again|retry|temporar(y|ily)|transient|rate.?limit)/i;

/** Mitigations per turn at most, as in Grok Bot. */
const MAX_MITIGATIONS = 16;

export function normaliseToolOutput(text: string): string {
  return VOLATILE.reduce((t, [re, to]) => t.replace(re, to), text).trim();
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** Bare tool name: `mcp__openbot__browser_read` and `browser_read` are the same tool. */
export function bareToolName(name: string): string {
  const parts = name.split("__");
  return parts[parts.length - 1] ?? name;
}

interface TurnState {
  sig: string;
  result: string;
  n: number;
  mitigations: number;
  invited: boolean;
}

export class ToolLoopDetector {
  private readonly turns = new Map<string, TurnState>();

  constructor(
    private readonly mode: LoopMode,
    private readonly onDetect?: (detection: LoopDetection) => void,
  ) {}

  /** Records a finished call; returns what to do about it (always "none" unless `on`). */
  observe(turnId: string, tool: string, args: unknown, result: string, botId?: string): LoopAction {
    if (this.mode === "off") return "none";
    const name = bareToolName(tool);
    const sig = `${name}:${stableJson(args)}`;
    const norm = normaliseToolOutput(result);
    const prev = this.turns.get(turnId);
    const same = prev !== undefined && prev.sig === sig && prev.result === norm;
    // A retry the tool itself asked for is not a repetition.
    const n = same ? (prev.invited ? prev.n : prev.n + 1) : 1;
    const state: TurnState = {
      sig,
      result: norm,
      n,
      mitigations: prev?.mitigations ?? 0,
      invited: INVITED_RETRY.test(result),
    };
    this.turns.delete(turnId);
    this.turns.set(turnId, state);
    // Turns that ended without `endTurn` are dropped oldest first.
    if (this.turns.size > 500) this.turns.delete(this.turns.keys().next().value as string);
    const min = TOLERANT_TOOLS.has(name) ? 4 : 2;
    if (n < min || state.mitigations >= MAX_MITIGATIONS) return "none";
    state.mitigations += 1;
    const action: Exclude<LoopAction, "none"> = n === min ? "retry_once" : "loop_reminder";
    this.onDetect?.({
      turnId,
      ...(botId ? { botId } : {}),
      tool: name,
      repetitions: n,
      action,
      mode: this.mode,
    });
    return this.mode === "on" ? action : "none";
  }

  /** The turn is over: forget it. */
  endTurn(turnId: string): void {
    this.turns.delete(turnId);
  }
}

/** What the model reads next to a result it already got. */
export function loopReminder(action: Exclude<LoopAction, "none">, repetitions: number): string {
  return action === "retry_once"
    ? `This call returned exactly the same result as the previous identical call. If you expected a change, wait or check why; otherwise do not call it again with the same input.`
    : `<system_reminder>This exact call has now returned the same result ${repetitions} times in a row: you are going in circles. Stop repeating it. Take a genuinely different route (another page, another tool, a different query or input), or report what is missing.</system_reminder>`;
}
