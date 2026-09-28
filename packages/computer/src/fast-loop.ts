import type {
  Action,
  ActionOp,
  Band,
  DecisionService,
  Observation,
  ObservedElement,
  Screen,
} from "@openbot/contracts";
import { bandForAnswer, UNCONFIGURED_MODEL } from "@openbot/decisions";
import { buildComputerActionQuestions } from "@openbot/decisions";
import { buildCandidates, type Candidate } from "./candidates.js";
import { buildDecisionState } from "@openbot/decisions";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import { isSensitiveLabel } from "./sensitive-target.js";

export type StepOutcome =
  "executed" | "escalated" | "blocked" | "done" | "takeover" | "denied" | "cancelled";

export interface ComputerStepEvent {
  step: number;
  observation: Observation;
  action?: Action;
  /** Label of the element the action targeted, for timelines. */
  targetLabel?: string;
  decisionId?: string;
  opBand?: Band;
  targetBand?: Band;
  outcome: StepOutcome;
  reason?: string;
}

export type ComputerPhase = "opening" | "looking" | "deciding" | "acting";

export interface TypeTextContext {
  goal: string;
  observation: Observation;
  target?: ObservedElement;
}

export interface FastLoopOptions {
  screen: Screen;
  decisionService: DecisionService;
  goal: string;
  botId: string;
  chainId: string;
  providerId: string;
  maxSteps?: number;
  startUrl?: string;
  broker?: ComputerActionBroker;
  onStep?: (event: ComputerStepEvent) => void;
  /**
   * Text for a `type` step. Jev picks the field; the engine that started the task
   * authors the text (Jev has no free-text output). May wait for the engine to
   * answer; resolving `null` escalates the task.
   */
  textForType?: (ctx: TypeTextContext) => Promise<string | null>;
  /** Extra instructions the engine added while the task runs (steering). */
  instructions?: () => string[];
  /** Checked before every step; true stops the loop as cancelled. */
  shouldStop?: () => boolean;
  /** What the loop is doing right now, for progress displays. */
  onPhase?: (phase: ComputerPhase) => void;
  /** Per-phase limits in ms (defaults: observe 15 s, decide 20 s, act 30 s). */
  timeouts?: Partial<Record<"observe" | "decide" | "act", number>>;
  /** Same observation hash repeated this many times triggers escalation. */
  stallThreshold?: number;
  /** Pause after a click, key or typing so the next look sees the new page. */
  settleMs?: number;
}

export interface FastLoopResult {
  status: "completed" | "failed" | "escalated" | "takeover" | "cancelled";
  steps: number;
  lastObservation?: Observation;
  summary?: string;
}

const DEFAULT_MAX_STEPS = 50;
const DEFAULT_STALL_THRESHOLD = 3;
const RECENT_STEPS_IN_STATE = 6;

/**
 * Runs the loop; when it stops short (stalled, out of steps, stuck on a
 * target) while a page is in view, Jev checks that page against the goal once,
 * so a task that already got there isn't reported as a failure.
 */
export async function runFastLoop(options: FastLoopOptions): Promise<FastLoopResult> {
  const result = await runSteps(options);
  if (result.status !== "escalated" && result.status !== "failed") return result;
  if (!result.lastObservation || options.shouldStop?.()) return result;
  const met = await goalAlreadyMet(options, result.lastObservation);
  if (!met) return result;
  options.onStep?.({
    step: result.steps + 1,
    observation: result.lastObservation,
    action: { op: "done" },
    decisionId: met.decisionId,
    outcome: "done",
    reason: "Jev checked the page: the goal is already done.",
  });
  return {
    status: "completed",
    steps: result.steps + 1,
    lastObservation: result.lastObservation,
    summary: "goal satisfied (checked by Jev)",
  };
}

const GOAL_CHECK_CONFIDENCE = 0.85;

async function goalAlreadyMet(
  options: FastLoopOptions,
  observation: Observation,
): Promise<{ decisionId: string } | undefined> {
  const state = buildDecisionState({
    goal: options.goal,
    url: observation.url,
    title: observation.title,
    observed_elements: observation.elements.map((el) => ({
      index: el.index,
      role: el.role,
      name: el.label,
      value: el.value,
    })),
  });
  try {
    const decision = await withDeadline(
      options.decisionService.decide({
        purpose: "computer",
        state,
        questions: {
          goal_met: {
            type: "choice",
            instructions:
              "Looking only at `url`, `title` and `observed_elements`, is `goal` already accomplished on this page?",
            criteria: {
              yes: "The page shows the goal is done (e.g. the requested page is open or the result is visible)",
              no: "The goal is not done yet, or the page doesn't show it",
            },
          },
        },
      }),
      options.timeouts?.decide ?? 20_000,
      "goal check timed out",
    );
    const answer = decision.answers.goal_met;
    if (decision.provider !== "jev") return undefined;
    if (answer?.type !== "choice" || answer.choice !== "yes") return undefined;
    if ((answer.confidence ?? 0) < GOAL_CHECK_CONFIDENCE) return undefined;
    return { decisionId: decision.decisionId };
  } catch {
    return undefined;
  }
}

async function runSteps(options: FastLoopOptions): Promise<FastLoopResult> {
  const {
    screen,
    decisionService,
    goal,
    botId,
    chainId,
    providerId,
    maxSteps = DEFAULT_MAX_STEPS,
    startUrl,
    broker: optionsBroker,
    onStep,
    textForType,
    instructions,
    shouldStop,
    onPhase,
    timeouts = {},
    stallThreshold = DEFAULT_STALL_THRESHOLD,
    // The fake computer changes pages instantly; real browsers need a moment.
    settleMs = options.providerId === "fake" ? 0 : 700,
  } = options;
  const limit = { observe: 15_000, decide: 20_000, act: 30_000, ...timeouts };
  const observe = async () => {
    onPhase?.("looking");
    return withDeadline(screen.observe(), limit.observe, "Looking at the screen took too long.");
  };

  const broker = optionsBroker ?? new DefaultComputerActionBroker();
  const recent: string[] = [];
  const remember = (line: string) => {
    recent.push(line);
    if (recent.length > RECENT_STEPS_IN_STATE) recent.shift();
  };

  if (startUrl) {
    onPhase?.("opening");
    const nav = await withDeadline(
      screen.act({ op: "navigate", url: startUrl }),
      limit.act,
      "Opening the page took too long.",
    ).catch((error: unknown) => ({ ok: false, reason: String((error as Error).message ?? error) }));
    if (!nav.ok) {
      return { status: "failed", steps: 0, summary: nav.reason ?? "navigation failed" };
    }
    remember(`opened ${startUrl}`);
  }

  let steps = 0;
  const observationHashes: string[] = [];
  const closedNotices = new Set<string>();

  while (steps < maxSteps) {
    if (shouldStop?.()) {
      return { status: "cancelled", steps, summary: "cancelled" };
    }
    steps += 1;
    let observation: Observation;
    try {
      observation = await observe();
    } catch (error) {
      return { status: "escalated", steps, summary: messageOf(error) };
    }
    const hash = hashObservation(observation);
    observationHashes.push(hash);
    const stallCount = countTrailingEqual(observationHashes, hash);
    if (stallCount >= stallThreshold) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        outcome: "escalated",
        reason: "The page stopped changing, so I stopped to avoid repeating myself.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    // Cookie notices block the page and aren't part of any goal: close them
    // without asking Jev (once per notice), still through the broker.
    const consent = consentButton(observation);
    const consentKey = consent ? `${observation.url ?? ""}|${consent.label}` : "";
    if (consent && !closedNotices.has(consentKey)) {
      closedNotices.add(consentKey);
      const action: Action = { op: "click", target: consent.index };
      const check = await broker.checkAction({
        botId,
        chainId,
        action,
        observation,
        providerId,
        isDestructive: false,
        sensitiveLabel: false,
      });
      if (check === "allow") {
        onPhase?.("acting");
        const result = await withDeadline(screen.act(action), limit.act, "timeout").catch(() => ({
          ok: false,
        }));
        if (result.ok) {
          remember(`closed the cookie notice ("${consent.label}")`);
          onStep?.({
            step: steps,
            observation,
            action,
            targetLabel: consent.label,
            outcome: "executed",
            reason: "Closed a cookie notice",
          });
          continue;
        }
      }
    }

    const extra = instructions?.() ?? [];
    const state = buildDecisionState({
      goal,
      ...(extra.length > 0 ? { instructions: extra } : {}),
      ...(recent.length > 0 ? { recent_steps: [...recent] } : {}),
      url: observation.url,
      title: observation.title,
      observed_elements: observation.elements.map((el) => ({
        index: el.index,
        role: el.role,
        name: el.label,
        value: el.value,
      })),
    });

    const candidates = buildCandidates(observation, {
      goal,
      typedRecently: recent.length > 0 && recent[recent.length - 1]!.startsWith("typed into"),
    });
    const questions = buildComputerActionQuestions(candidates);
    onPhase?.("deciding");
    let decision: Awaited<ReturnType<DecisionService["decide"]>>;
    try {
      decision = await withDeadline(
        decisionService.decide({ purpose: "computer", state, questions }),
        limit.decide,
        "Jev didn't answer in time, so I stopped instead of guessing.",
      );
    } catch (error) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        outcome: "escalated",
        reason: messageOf(error),
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    if (shouldStop?.()) {
      return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
    }

    const actionAnswer = decision.answers.action;
    const destructiveAnswer = decision.answers.is_destructive;
    const opBand = bandForAnswer(actionAnswer);
    const targetBand = opBand;
    const choiceId = parseChoice(actionAnswer, "");
    const chosen = candidates.find((c) => c.id === choiceId);

    if (decision.provider !== "jev" && opBand === "human") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason:
          decision.model === UNCONFIGURED_MODEL
            ? "No Jev (TypeSafe) key is set, so I stopped instead of guessing. Add it in Settings → Jev."
            : "Jev is unavailable, so I stopped instead of guessing.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    // Confident enough? Reversible steps (a plain click, scrolling, Escape) may
    // run when Jev clearly leans to one option; typing, submitting, "done" and
    // "blocked" need the usual confidence.
    const lead = clearLead(actionAnswer);
    const sure =
      opBand !== "human" ||
      (chosen?.reversible === true &&
        !(chosen.element && isSensitiveLabel(chosen.element.label)) &&
        lead.top >= 0.3 &&
        lead.top >= lead.second * 1.5);
    if (!chosen && choiceId && opBand !== "human") {
      // A target must be something that was actually observed on this page.
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: "The chosen element isn't on the page.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }
    if (!chosen || !sure) {
      const likely = topChoices(actionAnswer, candidates, 3);
      const reason = likely
        ? `I wasn't sure what to do next on this page. Most likely: ${likely}.`
        : "I wasn't sure what to do next on this page.";
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "escalated",
        reason,
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: reason };
    }

    const op = chosen.action.op as ActionOp;
    if (op === "done") {
      onStep?.({
        step: steps,
        observation,
        action: { op: "done" },
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "done",
      });
      return {
        status: "completed",
        steps,
        lastObservation: observation,
        summary: "goal satisfied",
      };
    }

    if (op === "blocked") {
      await screen.takeover(true);
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action: { op: "blocked" },
        decisionId: decision.decisionId,
        outcome: "takeover",
        reason: "This step needs you (login, 2FA, CAPTCHA, or payment). Take over the screen.",
      };
      onStep?.(event);
      return { status: "takeover", steps, lastObservation: observation, summary: event.reason };
    }

    const targetElement = chosen.element;
    const sensitiveLabel = targetElement ? isSensitiveLabel(targetElement.label) : false;
    const isDestructive =
      destructiveAnswer?.type === "noul" ? destructiveAnswer.noul >= 0.5 : false;

    let action: Action = { ...chosen.action };
    if (op === "type" && targetElement) {
      const text = textForType
        ? await textForType({ goal, observation, target: targetElement })
        : null;
      if (shouldStop?.()) {
        return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
      }
      if (!text) {
        const event: ComputerStepEvent = {
          step: steps,
          observation,
          targetLabel: targetElement.label,
          decisionId: decision.decisionId,
          opBand,
          targetBand,
          outcome: "escalated",
          reason: `I needed text for "${targetElement.label}" and didn't get it.`,
        };
        onStep?.(event);
        return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
      }
      action = { ...action, text };
    }

    const brokerDecision = await broker.checkAction({
      botId,
      chainId,
      action,
      observation,
      providerId,
      isDestructive,
      sensitiveLabel,
    });
    if (brokerDecision === "deny") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "denied",
        reason: "You denied this step.",
      };
      onStep?.(event);
      return { status: "failed", steps, lastObservation: observation, summary: event.reason };
    }
    if (brokerDecision === "ask") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "blocked",
        reason: "This step needs your approval.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    onPhase?.("acting");
    let result: Awaited<ReturnType<Screen["act"]>>;
    try {
      result = await withDeadline(screen.act(action), limit.act, "The action took too long.");
    } catch (error) {
      result = { ok: false, reason: messageOf(error) };
    }
    if (result.blocked) {
      await screen.takeover(true);
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "takeover",
        reason: result.reason ?? "The computer needs you to take over.",
      };
      onStep?.(event);
      return { status: "takeover", steps, lastObservation: observation, summary: event.reason };
    }

    if (!result.ok) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: result.reason ?? "The action failed.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    remember(describeAction(action, targetElement));
    if (settleMs > 0 && ["click", "key", "type", "select"].includes(action.op)) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }
    onStep?.({
      step: steps,
      observation,
      action,
      targetLabel: targetElement?.label,
      decisionId: decision.decisionId,
      opBand,
      targetBand,
      outcome: "executed",
    });
  }

  const lastObservation = await observe().catch(() => undefined);
  return {
    status: "escalated",
    steps,
    lastObservation,
    summary: `Stopped after ${steps} steps without finishing.`,
  };
}

/** Buttons that dismiss a cookie/consent notice; rejecting is preferred. */
const REJECT_LABELS =
  /^(reject all( cookies)?|decline all|refuse all|rechazar todo|rechazar todas|rechazar|tout refuser|alle ablehnen|rifiuta tutto)$|^(reject|rechazar) (the use of|el uso de) (cookies|las cookies)/i;
const ACCEPT_LABELS =
  /^(accept all( cookies)?|allow all( cookies)?|i agree|agree|aceptar todo|aceptar todas|aceptar|tout accepter|alle akzeptieren|accetta tutto)$|^(accept|aceptar) (the use of|el uso de) (cookies|las cookies)/i;

function consentButton(observation: Observation): ObservedElement | undefined {
  const text = observation.elements.map((el) => el.label).join(" ");
  if (!/cookie|consent|privacidad|privacy|datenschutz/i.test(text)) return undefined;
  const clickable = observation.elements.filter((el) => /^(button|a|link|input)$/i.test(el.role));
  return (
    clickable.find((el) => REJECT_LABELS.test(el.label.trim())) ??
    clickable.find((el) => ACCEPT_LABELS.test(el.label.trim()))
  );
}

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A short line Jev sees next step, so it doesn't redo what just happened. */
function describeAction(action: Action, target?: ObservedElement): string {
  const what = target ? ` "${target.label}"` : "";
  switch (action.op) {
    case "type":
      return `typed into${what}`;
    case "key":
      return `pressed ${action.text ?? "a key"}`;
    case "scroll":
      return `scrolled ${action.text ?? "down"}`;
    default:
      return `${action.op}${what}`;
  }
}

/** The top two probabilities of a choice answer. */
function clearLead(answer: JevAnswerLike | undefined): { top: number; second: number } {
  const values = Object.values(answer?.probabilities ?? {}).sort((a, b) => b - a);
  return { top: values[0] ?? 0, second: values[1] ?? 0 };
}

/** "click “Search” (38%), type into “Search” (36%)": for the engine to steer with. */
function topChoices(
  answer: JevAnswerLike | undefined,
  candidates: Candidate[],
  count: number,
): string | undefined {
  const entries = Object.entries(answer?.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id, p]) => {
      const c = candidates.find((x) => x.id === id);
      return c
        ? `${c.description.charAt(0).toLowerCase()}${c.description.slice(1)} (${Math.round(p * 100)}%)`
        : undefined;
    })
    .filter(Boolean);
  return entries.length ? entries.join(", ") : undefined;
}

type JevAnswerLike = { type: string; choice?: string; probabilities?: Record<string, number> };

function parseChoice(
  answer: { type: string; choice?: string } | undefined,
  fallback: string,
): string {
  if (answer?.type === "choice" && answer.choice) return answer.choice;
  return fallback;
}

function hashObservation(observation: Observation): string {
  return JSON.stringify({
    url: observation.url,
    title: observation.title,
    elements: observation.elements.map((el) => [el.index, el.role, el.label, el.value]),
  });
}

function countTrailingEqual(values: string[], value: string): number {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== value) break;
    count += 1;
  }
  return count;
}
