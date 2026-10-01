import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OBEvent } from "@openbot/contracts";
import { buildServer, createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { bootstrapHarness } from "./bootstrap.js";

/**
 * C11: one versioned check of what a Bot does with a prompt. Cases live in `evals/cases/*.json`
 * and run against a fresh, throw-away OpenBot: fake engines by default (CI, no credentials),
 * the real signed-in engines with `--real`.
 */
export interface EvalCase {
  id: string;
  description?: string;
  /** Only meaningful against real engines (skipped without `--real`). */
  real?: boolean;
  /** Uses the fake engine's directives (`@tool ...`): skipped with `--real`. */
  fakeOnly?: boolean;
  bot?: {
    name?: string;
    description?: string;
    permissionPreset?: "read_only" | "workspace_write" | "full";
    computer?: "none" | "docker" | "docker+local";
    engine?: string;
  };
  prompt: string;
  timeoutSeconds?: number;
  expect?: {
    status?: "completed" | "failed" | "interrupted";
    replyIncludes?: string[];
    replyExcludes?: string[];
    /** A regular expression the reply must match (case-insensitive). */
    replyMatches?: string;
    toolsUsed?: string[];
    toolsNotUsed?: string[];
    /** At most this many approval cards. */
    maxApprovals?: number;
  };
  /** Asks Jev whether the reply does what this says (a choice of pass/fail with confidence). */
  judge?: { criterion: string; minConfidence?: number };
}

export interface EvalResult {
  id: string;
  passed: boolean;
  skipped?: string;
  reasons: string[];
  status?: string;
  reply: string;
  tools: string[];
  approvals: number;
  seconds: number;
  judge?: { verdict: string; confidence: number };
}

export interface EvalOptions {
  /** Run on the signed-in engines instead of the fake one. */
  real?: boolean;
  /** Use Jev for `judge` criteria (needs a TypeSafe key); otherwise judged cases are skipped. */
  jev?: boolean;
  log?: (line: string) => void;
}

const EVAL_CONTAINER = "openbot-desktop-eval";

function removeContainer(name: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("docker", ["rm", "-f", name], () => resolve());
  });
}

export async function loadEvalCases(dir: string): Promise<EvalCase[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const cases: EvalCase[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as EvalCase;
    if (!parsed.id || typeof parsed.prompt !== "string") {
      throw new Error(`${name}: an eval case needs "id" and "prompt"`);
    }
    cases.push(parsed);
  }
  return cases;
}

/** Runs the cases one after another on a fresh OpenBot home, which is deleted afterwards. */
export async function runEvals(
  cases: EvalCase[],
  options: EvalOptions = {},
): Promise<EvalResult[]> {
  const log = options.log ?? (() => undefined);
  const home = await mkdtemp(join(tmpdir(), "openbot-eval-"));
  const restoreEnv = withEnv({
    OPENBOT_FAKE_ENGINES: options.real ? undefined : "1",
    OPENBOT_FAKE_COMPUTER: options.real ? undefined : "1",
    OPENBOT_FAKE_JEV: options.jev ? undefined : "1",
    OPENBOT_MCP_REGISTRY_URL: "http://127.0.0.1:9",
    // Engines that keep state under OpenBot's home (Codex's private home) use the throw-away one.
    OPENBOT_HOME: home,
    // Real runs get their own virtual machine, never the installed app's (container, ports,
    // sign-ins); the owner can still point them elsewhere.
    OPENBOT_DESKTOP_CONTAINER: process.env.OPENBOT_DESKTOP_CONTAINER ?? EVAL_CONTAINER,
    OPENBOT_DESKTOP_CONTROL_PORT: process.env.OPENBOT_DESKTOP_CONTROL_PORT ?? "8807",
    OPENBOT_DESKTOP_VIEW_PORT: process.env.OPENBOT_DESKTOP_VIEW_PORT ?? "6100",
    OPENBOT_DESKTOP_VOLUME: process.env.OPENBOT_DESKTOP_VOLUME ?? "openbot-browser-eval",
  });
  const results: EvalResult[] = [];
  let ctx: CoreContext | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let drivers: Array<{ dispose(): Promise<void> } | undefined> = [];
  try {
    const port = await freePort();
    ctx = await createCoreContext({
      config: loadConfig({ env: { ...process.env, OPENBOT_HOME: home, PORT: String(port) } }),
      disableNdjson: true,
      // In-process only: nothing but this runner talks to it.
      localOwnerKey: false,
    });
    app = await buildServer(ctx, { wireRemote: false });
    const harness = await bootstrapHarness(ctx, app);
    drivers = Object.values(harness.drivers);
    await app.listen({ port, host: "127.0.0.1" });
    ctx.repos.setupState.patch({ completedAt: ctx.clock.now().toISOString() });
    for (const c of cases) {
      const result =
        c.real && !options.real
          ? skipped(c, "needs real engines (--real)")
          : c.fakeOnly && options.real
            ? skipped(c, "uses the fake engine's directives")
            : c.judge && !options.jev
              ? skipped(c, "needs Jev to judge (--jev)")
              : await runCase(ctx, app, c, options);
      results.push(result);
      log(
        `${result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL"}  ${c.id}${
          result.skipped
            ? ` (${result.skipped})`
            : result.passed
              ? ""
              : `: ${result.reasons.join("; ")}`
        }`,
      );
    }
  } finally {
    // Real engines keep child processes (Claude per session, Codex's app-server): without this
    // the command never exits.
    await Promise.all(drivers.map((d) => d?.dispose().catch(() => undefined)));
    await app?.close().catch(() => undefined);
    ctx?.closeDb();
    // The eval machine goes with the run (its browser volume stays, for the next run's sign-ins).
    if (options.real && (process.env.OPENBOT_DESKTOP_CONTAINER ?? "") === EVAL_CONTAINER) {
      await removeContainer(EVAL_CONTAINER);
    }
    restoreEnv();
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
  return results;
}

function skipped(c: EvalCase, why: string): EvalResult {
  return {
    id: c.id,
    passed: true,
    skipped: why,
    reasons: [],
    reply: "",
    tools: [],
    approvals: 0,
    seconds: 0,
  };
}

async function runCase(
  ctx: CoreContext,
  app: Awaited<ReturnType<typeof buildServer>>,
  c: EvalCase,
  options: EvalOptions,
): Promise<EvalResult> {
  const started = Date.now();
  const created = await app.inject({
    method: "POST",
    url: "/api/bots",
    payload: {
      name: c.bot?.name ?? `Eval ${c.id}`,
      description: c.bot?.description ?? "an evaluation bot",
      routing: c.bot?.engine
        ? { mode: "pinned", engine: c.bot.engine }
        : options.real
          ? { mode: "auto" }
          : { mode: "pinned", engine: "fake" },
      ...(c.bot?.permissionPreset ? { permissionPreset: c.bot.permissionPreset } : {}),
      ...(c.bot?.computer ? { computer: c.bot.computer } : {}),
    },
  });
  if (created.statusCode >= 300) {
    return fail(c, started, [`could not create the bot (${created.statusCode})`]);
  }
  const botId = (created.json() as { bot: { id: string } }).bot.id;

  const tools: string[] = [];
  let approvals = 0;
  let reply = "";
  let status: string | undefined;
  let unsubscribe = () => {};
  const done = new Promise<void>((resolve) => {
    const stop = ctx.eventBus.subscribe((event: OBEvent) => {
      if (event.botId !== botId) return;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      if (event.type === "tool.started" && typeof payload.toolName === "string") {
        tools.push(payload.toolName);
      } else if (event.type === "approval.requested") {
        approvals += 1;
      } else if (event.type === "message.created" && typeof payload.text === "string") {
        reply = payload.text;
      } else if (
        event.type === "turn.completed" ||
        event.type === "turn.failed" ||
        event.type === "turn.interrupted"
      ) {
        status = event.type.slice("turn.".length);
        unsubscribe();
        // The reply message is published right after the turn ends.
        setTimeout(resolve, 50);
      }
    });
    unsubscribe = stop;
  });

  const sent = await ctx.mailbox?.enqueue({ botId, text: c.prompt });
  if (!sent || !("ok" in sent) || !sent.ok) {
    return fail(c, started, [`the message was not accepted: ${JSON.stringify(sent)}`]);
  }
  const timeoutMs = (c.timeoutSeconds ?? (options.real ? 300 : 30)) * 1000;
  const timedOut = await Promise.race([
    done.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), timeoutMs)),
  ]);
  if (timedOut) {
    unsubscribe();
    await ctx.mailbox?.stopBot(botId).catch(() => undefined);
  }
  // The reply as the user sees it: the bot's last message in its chat.
  const thread = ctx.repos.threads.getByBotId(botId);
  const stored = thread
    ? ctx.repos.messages
        .list({ threadId: thread.id })
        .filter((m) => m.author.type === "bot")
        .at(-1)
    : undefined;
  if (stored?.text) reply = stored.text;

  const reasons = timedOut
    ? [`no answer within ${timeoutMs / 1000} s`]
    : checkExpectations(c, { reply, tools, approvals, status });
  let judge: EvalResult["judge"];
  if (!timedOut && c.judge && ctx.decisionService) {
    judge = await judgeReply(ctx, c, reply);
    const min = c.judge.minConfidence ?? 0.7;
    if (judge.verdict !== "pass" || judge.confidence < min) {
      reasons.push(
        `Jev judged "${judge.verdict}" (${judge.confidence.toFixed(2)}) on: ${c.judge.criterion}`,
      );
    }
  }
  return {
    id: c.id,
    passed: reasons.length === 0,
    reasons,
    status,
    reply,
    tools,
    approvals,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(judge ? { judge } : {}),
  };
}

/** The rule checks of a case: plain, deterministic, and each failure says what was off. */
export function checkExpectations(
  c: EvalCase,
  got: { reply: string; tools: string[]; approvals: number; status?: string },
): string[] {
  const e = c.expect ?? {};
  const reasons: string[] = [];
  const reply = got.reply.toLowerCase();
  if (e.status && got.status !== e.status)
    reasons.push(`turn ${got.status ?? "?"}, expected ${e.status}`);
  for (const s of e.replyIncludes ?? []) {
    if (!reply.includes(s.toLowerCase())) reasons.push(`reply lacks "${s}"`);
  }
  for (const s of e.replyExcludes ?? []) {
    if (reply.includes(s.toLowerCase())) reasons.push(`reply contains "${s}"`);
  }
  if (e.replyMatches && !new RegExp(e.replyMatches, "i").test(got.reply)) {
    reasons.push(`reply doesn't match /${e.replyMatches}/`);
  }
  const used = (name: string) => got.tools.some((t) => t === name || t.endsWith(`__${name}`));
  for (const t of e.toolsUsed ?? []) if (!used(t)) reasons.push(`tool ${t} not used`);
  for (const t of e.toolsNotUsed ?? []) if (used(t)) reasons.push(`tool ${t} was used`);
  if (e.maxApprovals !== undefined && got.approvals > e.maxApprovals) {
    reasons.push(`${got.approvals} approval cards (at most ${e.maxApprovals})`);
  }
  return reasons;
}

async function judgeReply(
  ctx: CoreContext,
  c: EvalCase,
  reply: string,
): Promise<{ verdict: string; confidence: number }> {
  const result = await ctx.decisionService!.decide({
    purpose: "triage",
    state: { request: c.prompt, reply: reply.slice(0, 6000) },
    questions: {
      verdict: {
        type: "choice",
        instructions: `Does the reply satisfy this requirement? ${c.judge!.criterion}`,
        criteria: {
          pass: "The reply clearly satisfies the requirement.",
          fail: "The reply misses, contradicts or only partly satisfies the requirement.",
        },
      },
    },
  });
  const answer = result.answers.verdict as { choice?: string; confidence?: number } | undefined;
  return { verdict: answer?.choice ?? "fail", confidence: answer?.confidence ?? 0 };
}

function fail(c: EvalCase, started: number, reasons: string[]): EvalResult {
  return {
    id: c.id,
    passed: false,
    reasons,
    reply: "",
    tools: [],
    approvals: 0,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

function withEnv(values: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
