import { monotonicFactory } from "ulid";
import {
  type Band,
  bandConfidence,
  type Bot,
  type Budget,
  type BudgetStatus,
  DEFAULT_LOCAL_BANDS,
  type DecideRequest,
  type DecideResult,
  type DecisionService,
  type DecisionSettings,
  type JevAnswer,
  type JevQuestion,
  type ProviderBands,
  type Purpose,
  type RouteContext,
  type RouteDecision,
} from "@openbot/contracts";
import { conservativeFallbackAnswers } from "./fallbacks.js";
import { DecisionLog, primaryAnswerIdForPurpose } from "./decision-log.js";
import { JevClient, jevTimeoutMs } from "./jev-client.js";
import { routeBot } from "./router.js";

const ulid = monotonicFactory();

/** The most options a `choice` may have to go to a small local model in hybrid mode. */
export const HYBRID_MAX_OPTIONS = 8;
/** The longest state (characters of JSON) a small local model gets in hybrid mode. */
export const HYBRID_MAX_STATE_CHARS = 3000;

/** A local Jev-compatible server's answer time limit: longer than Jev's (a CPU is slow). */
const LOCAL_TIMEOUT_MS = 15_000;
/** In hybrid mode Jev is waiting behind it: a slow local server hands over sooner. */
const HYBRID_TIMEOUT_MS = 5_000;

/** Model label when pictures couldn't be read: the question is never answered without them. */
export const VISION_UNAVAILABLE_MODEL = "vision-unavailable";

/**
 * An image model's bands (V4). Measured on real pages with ImaJev 4B (2026-10-02): an order
 * confirmation answered "goal done" at 0.89, a sign-in form and a CAPTCHA "wall" at 0.87 and 0.85,
 * ordinary pages 0.02 to 0.2; its card reports 97.5% right when it is at least 90% sure.
 */
export const VISION_BANDS: ProviderBands = { autoMin: 0.85, confirmMin: 0.5 };

/** Purposes kept on Jev in hybrid mode: the computer, and the risk gate that can skip a card. */
const JEV_ONLY_PURPOSES = new Set(["computer", "risk"]);

/** Model label when a local decision failed and no other provider could answer. */
export const LOCAL_UNAVAILABLE_MODEL = "local-unavailable-conservative";

export interface RoutedDecisionServiceOptions {
  /** TypeSafe Jev (the keyed service). */
  jev: DecisionService;
  /** The owner's decision settings, read per call so a change applies at once. */
  settings: () => DecisionSettings | undefined;
  /** The local server's key (vault), if it needs one. */
  localKey?: () => Promise<string | undefined>;
  /** Where local decisions are recorded (Jev records its own). */
  log?: DecisionLog;
  /** Builds the client of a Jev-compatible server (tests pass a fake). */
  client?: (baseUrl: string, apiKey: string) => Pick<JevClient, "systemOne">;
}

/**
 * D-037: sends each decision to TypeSafe Jev, to a local Jev-compatible server (Laya, ImaJev...)
 * or, in hybrid mode, to whichever suits the question. A local model's confidence is put on Jev's
 * scale using that provider's own bands, so every gate keeps its thresholds.
 */
export class RoutedDecisionService implements DecisionService {
  private readonly client: (baseUrl: string, apiKey: string) => Pick<JevClient, "systemOne">;
  private readonly log: DecisionLog;

  constructor(private readonly options: RoutedDecisionServiceOptions) {
    this.client =
      options.client ?? ((baseUrl, apiKey) => new JevClient({ baseUrl, apiKey, maxRetries: 0 }));
    this.log = options.log ?? new DecisionLog();
  }

  /** The TypeSafe Jev service behind this router (diagnostics and tests). */
  get jevService(): DecisionService {
    return this.options.jev;
  }

  /** V4: true when screenshots sent with a decision are read by an image model. */
  canSeeImages(): boolean {
    return Boolean(this.options.settings()?.visionUrl);
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const settings = this.options.settings();
    const { images, ...textOnly } = req;

    // A question about a picture is only ever answered by a model that read the picture: when
    // none can, it gets the safe answers (never Jev guessing from the text alone).
    if (images?.length) {
      if (settings?.visionUrl) {
        try {
          const seen = await this.decideLocal(req, settings.visionUrl, DEFAULT_LOCAL_BANDS, {
            model: "vision",
          });
          return { ...seen, sawImages: true };
        } catch {
          // falls through to the safe answers
        }
      }
      return this.unavailable(textOnly, VISION_UNAVAILABLE_MODEL);
    }

    const mode = settings?.mode ?? "jev";
    const localUrl = settings?.localUrl;
    if (mode === "jev" || !localUrl) return this.options.jev.decide(textOnly);

    if (mode === "local" || suitsLocal(textOnly)) {
      try {
        return await this.decideLocal(textOnly, localUrl, settings.localBands, {
          timeoutMs: mode === "hybrid" ? HYBRID_TIMEOUT_MS : undefined,
        });
      } catch {
        if (mode === "hybrid") return this.options.jev.decide(textOnly);
        return this.unavailable(textOnly);
      }
    }
    return this.options.jev.decide(textOnly);
  }

  private async decideLocal(
    req: DecideRequest,
    baseUrl: string,
    bands: ProviderBands | undefined,
    extra: { timeoutMs?: number; model?: string } = {},
  ): Promise<DecideResult> {
    const key = (await this.options.localKey?.())?.trim() || "local";
    const result = await this.client(baseUrl, key).systemOne({
      state: req.state,
      questions: req.questions,
      timeoutMs:
        extra.timeoutMs ?? req.timeoutMs ?? Math.max(jevTimeoutMs(req.purpose), LOCAL_TIMEOUT_MS),
      ...(req.images?.length
        ? { images: req.images.map((i) => `data:${i.mime};base64,${i.data}`) }
        : {}),
    });
    const raw = result.response.answers ?? {};
    for (const [id, question] of Object.entries(req.questions)) {
      const problem = answerProblem(question, raw[id]);
      if (problem) throw new Error(`the local model's answer to "${id}" ${problem}`);
    }
    const answers = onJevScale(raw, bands ?? DEFAULT_LOCAL_BANDS);
    const model = String(result.response.model || extra.model || "local").slice(0, 80);
    const decisionId = this.log.record({
      purpose: req.purpose,
      provider: "local",
      model,
      state: req.state,
      questions: req.questions,
      answers,
      primaryAnswerId: primaryAnswerIdForPurpose(req.purpose, req.questions),
    });
    return { answers, provider: "local", model, latencyMs: result.latencyMs, decisionId };
  }

  private unavailable(req: DecideRequest, label = LOCAL_UNAVAILABLE_MODEL): DecideResult {
    const answers = conservativeFallbackAnswers({
      purpose: req.purpose,
      state: req.state,
      questions: req.questions,
    });
    const decisionId = this.log.record({
      purpose: req.purpose,
      provider: "heuristic",
      model: label,
      state: req.state,
      questions: req.questions,
      answers,
      primaryAnswerId: primaryAnswerIdForPurpose(req.purpose, req.questions),
    });
    return {
      answers,
      provider: "heuristic",
      model: label,
      latencyMs: 0,
      decisionId: decisionId || `dec_${ulid()}`,
    };
  }

  async route(bot: Bot, task: string, ctx: RouteContext): Promise<RouteDecision> {
    return routeBot(this, bot, task, ctx);
  }

  band(confidence: number, _purpose: Purpose): Band {
    return bandConfidence(confidence);
  }

  budgets(): Record<Budget, BudgetStatus> {
    return this.options.jev.budgets();
  }

  validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }> {
    return this.options.jev.validateKey(key);
  }
}

/** Why a local model's answer can't be used, or undefined when it can (types, options, ranges). */
export function answerProblem(
  question: JevQuestion,
  answer: JevAnswer | undefined,
): string | undefined {
  if (!answer) return "is missing";
  if (answer.type !== question.type) return `is a ${answer.type}, not a ${question.type}`;
  const unit = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  if (answer.type === "noul") return unit(answer.noul) ? undefined : "is not a probability";
  if (answer.type === "choice" && question.type === "choice") {
    if (!(answer.choice in question.criteria)) return "is not one of the options";
    return unit(answer.confidence) ? undefined : "has no usable confidence";
  }
  if (answer.type === "score" && question.type === "score") {
    const top = question.criteria.length - 1;
    if (!(typeof answer.score === "number" && answer.score >= 0 && answer.score <= top)) {
      return "is off the scale";
    }
    return unit(answer.confidence) ? undefined : "has no usable confidence";
  }
  return undefined;
}

/**
 * Hybrid mode: small yes/no, scale and few-option questions on a short state. Never the computer
 * loop, nor the risk gate (an "allow" there skips the user's card).
 */
export function suitsLocal(req: DecideRequest): boolean {
  if (JEV_ONLY_PURPOSES.has(req.purpose)) return false;
  const state = typeof req.state === "string" ? req.state : JSON.stringify(req.state);
  if (state.length > HYBRID_MAX_STATE_CHARS) return false;
  return Object.values(req.questions).every((q) => {
    if (q.type !== "choice") return true;
    return Object.keys(q.criteria).length <= HYBRID_MAX_OPTIONS;
  });
}

/**
 * Puts a confidence measured on a provider's own scale onto Jev's: its `autoMin` becomes 0.9 and its
 * `confirmMin` 0.5 (Jev's band edges), linearly in between, so the gates' thresholds still hold.
 */
export function onJevConfidence(confidence: number, bands: ProviderBands): number {
  if (!Number.isFinite(confidence)) return 0;
  const c = Math.min(1, Math.max(0, confidence));
  if (c === 0) return 0;
  const { autoMin, confirmMin } = bands;
  if (c >= autoMin) return autoMin >= 1 ? 1 : 0.9 + ((c - autoMin) / (1 - autoMin)) * 0.1;
  if (c >= confirmMin) return 0.5 + ((c - confirmMin) / (autoMin - confirmMin)) * 0.4;
  return confirmMin <= 0 ? 0.5 : (c / confirmMin) * 0.5;
}

/** Every answer's confidence on Jev's scale; a yes/no keeps its side and moves its distance from 0.5. */
export function onJevScale(
  answers: Record<string, JevAnswer>,
  bands: ProviderBands,
): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (answer.type === "noul") {
      const side = answer.noul >= 0.5 ? 1 : -1;
      const sure = onJevConfidence(Math.abs(answer.noul - 0.5) * 2, bands);
      out[id] = { ...answer, noul: 0.5 + (side * sure) / 2 };
    } else if ("confidence" in answer && typeof answer.confidence === "number") {
      out[id] = { ...answer, confidence: onJevConfidence(answer.confidence, bands) };
    } else {
      out[id] = answer;
    }
  }
  return out;
}
