import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { DecisionSettings, Settings } from "@openbot/contracts";
import type { CoreContext, SetupValidatorKind } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { SetupValidateBody, UpdateSettingsBody, type DecisionSettingsPatch } from "../schemas.js";

const DEFAULT_CAPS: Settings["caps"] = {
  // Loose on purpose: the Chief delegates by default and creates the bots it needs (D-023).
  s1_cosBotsCap: 10,
  s2_newBotsPer24h: 8,
  s3_spawnCooldownMin: 2,
  s4_proactivePerBotPerHour: 3,
  s4_proactivePerBotPerDay: 8,
  s5_proactiveAllBotsPerHour: 6,
  s6_dedupeWindowHours: 6,
  s10_mergeWindowMin: 10,
};
const DEFAULT_BUDGETS: Settings["budgets"] = {
  gates: 250,
  interactive: 200,
  computer: 450,
  background: 100,
};

function defaultSettings(ctx: CoreContext): Settings {
  return {
    id: "singleton",
    caps: DEFAULT_CAPS,
    budgets: DEFAULT_BUDGETS,
    updatedAt: ctx.clock.now().toISOString(),
  };
}

/** Applies a Settings > Jev change: "" clears an address; local and hybrid need a local server. */
type DecisionSettingsPatchInput = z.infer<typeof DecisionSettingsPatch>;

function mergeDecisionSettings(
  current: DecisionSettings | undefined,
  patch: DecisionSettingsPatchInput | undefined,
): { value?: DecisionSettings } | { error: string } {
  if (!patch) return { value: current };
  const next: DecisionSettings = {
    keepRequests: patch.keepRequests ?? current?.keepRequests ?? true,
    mode: patch.mode ?? current?.mode ?? "jev",
  };
  const localUrl = patch.localUrl === undefined ? current?.localUrl : patch.localUrl || undefined;
  const visionUrl =
    patch.visionUrl === undefined ? current?.visionUrl : patch.visionUrl || undefined;
  const localBands = patch.localBands ?? current?.localBands;
  if (localUrl) next.localUrl = localUrl;
  if (visionUrl) next.visionUrl = visionUrl;
  if (localBands) next.localBands = localBands;
  if (next.mode !== "jev" && !next.localUrl) {
    return { error: "add the local decision server's address before switching to it" };
  }
  return { value: next };
}

/** Settings (caps S1-S10/O7, budgets, quiet hours) and the setup wizard (plan §4.7). Owner-only writes. */
export function registerSettingsAndSetupRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/settings", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return { settings: ctx.repos.settings.get() ?? defaultSettings(ctx) };
  });

  // PUT and PATCH both merge the given fields into the current settings.
  const updateSettings = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(UpdateSettingsBody, request.body, reply);
    if (!body) return;

    const current: Settings = ctx.repos.settings.get() ?? defaultSettings(ctx);
    const decisions = mergeDecisionSettings(current.decisions, body.decisions);
    if ("error" in decisions) {
      return reply.code(400).send({ error: "invalid_request", reason: decisions.error });
    }
    const next: Settings = {
      ...current,
      caps: { ...current.caps, ...body.caps },
      budgets: { ...current.budgets, ...body.budgets },
      quietHours: body.quietHours ?? current.quietHours,
      botDefaults: body.botDefaults ?? current.botDefaults,
      ...(decisions.value ? { decisions: decisions.value } : {}),
      updatedAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.settings.upsert(next);
    // Turning "keep what decisions saw" off forgets what is already kept, too.
    if (body.decisions?.keepRequests === false) {
      ctx.repos.decisions.clearRequestsBefore(new Date(8.64e15));
    }
    await ctx.eventBus.publish({ type: "setup.changed", payload: { settings: next } });
    return { settings: next };
  };
  app.put("/api/settings", updateSettings);
  app.patch("/api/settings", updateSettings);

  app.get("/api/setup", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { setup: ctx.repos.setupState.get() };
  });

  app.post("/api/setup/validate", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = parseOrReject(SetupValidateBody, request.body, reply);
    if (!body) return;

    const result = await validate(ctx, body.kind, body.value);
    const setup = ctx.repos.setupState.patch(patchFor(body.kind, result));
    await ctx.eventBus.publish({ type: "setup.changed", payload: { kind: body.kind, result } });
    return { result, setup };
  });

  app.post("/api/setup/complete", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const setup = ctx.repos.setupState.patch({
      completedAt: ctx.clock.now().toISOString(),
    });
    await ctx.eventBus.publish({ type: "setup.changed", payload: { completed: true } });
    return { setup };
  });
}

async function validate(
  ctx: CoreContext,
  kind: SetupValidatorKind,
  value: string | undefined,
): Promise<{ ok: boolean; reason?: string; rpmLimit?: number }> {
  const validator = ctx.validators[kind];
  // A registered validator also saves the key; probing alone would report "ok"
  // while Jev keeps falling back because no key was ever stored.
  if (kind === "typesafe" && !validator) {
    if (!ctx.decisionService) return { ok: false, reason: "DecisionService not wired yet (WS7)" };
    return ctx.decisionService.validateKey(value ?? "");
  }
  if (!validator) return { ok: false, reason: `no validator registered for "${kind}" yet` };
  return validator(value);
}

function patchFor(
  kind: SetupValidatorKind,
  result: { ok: boolean; reason?: string },
): Parameters<CoreContext["repos"]["setupState"]["patch"]>[0] {
  switch (kind) {
    case "typesafe":
      return { typesafe: { ok: result.ok } };
    case "anthropic":
      return { claude: { ok: result.ok, mode: "api_key" } };
    case "claude_login":
      return { claude: { ok: result.ok, mode: "login" } };
    case "openai":
      return { codex: { ok: result.ok, mode: "api_key" } };
    case "codex_login":
      return { codex: { ok: result.ok, mode: "login" } };
    case "tailscale":
      return { tailscale: { ok: result.ok } };
    case "cloudflare":
      return { cloudflare: { ok: result.ok } };
  }
}
