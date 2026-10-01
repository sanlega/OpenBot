import type { FastifyInstance } from "fastify";
import type { CoreContext, CustomEngineSpec } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";

export const SERVER_VERSION = "0.1.18";

export function registerHealthRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/harness/status", async () => ({
    connected: true,
    version: SERVER_VERSION,
  }));

  app.get("/api/engines", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const statuses = ctx.engineStatuses ?? {};
    const descriptors = ctx.engineDescriptors ?? {};
    const ids = [...new Set([...Object.keys(descriptors), ...Object.keys(statuses)])];
    const engines = ids.map((id) => ({
      id,
      ...(statuses[id] ?? { installed: false, login: { ok: false }, apiKey: { ok: false } }),
      ...(descriptors[id] ? { descriptor: descriptors[id] } : {}),
      available: ctx.availableEngines?.includes(id) ?? false,
    }));
    return { engines };
  });

  // P1: "Check again" in Settings > Engines (after installing or signing in to a CLI).
  app.post("/api/engines/redetect", async (req, reply) => {
    if (!requireOwner(req, reply)) return;
    if (!ctx.redetectEngines) return reply.code(501).send({ error: "not wired" });
    const available = await ctx.redetectEngines();
    return { available };
  });

  /** Owner-added ACP agents (D-031), wired at once by detecting the engines again. */
  app.get("/api/engines/custom", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { engines: ctx.customEngines?.list() ?? [] };
  });

  app.put("/api/engines/custom", async (req, reply) => {
    // Saving starts the command (to detect it): owner only.
    if (!requireOwner(req, reply)) return;
    if (!ctx.customEngines) return reply.code(501).send({ error: "custom engines not wired" });
    const parsed = parseCustomEngines((req.body as { engines?: unknown } | undefined)?.engines);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });
    await ctx.customEngines.save(parsed.engines);
    // A new agent is wired now; removing one stops offering it (its process ends with its turn).
    const available = ctx.redetectEngines
      ? await ctx.redetectEngines().catch(() => undefined)
      : undefined;
    return {
      engines: parsed.engines,
      restartRequired: !available,
      ...(available ? { available } : {}),
    };
  });

  app.get("/api/models", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { engines: (await ctx.listModels?.()) ?? [] };
  });
}

const SLUG_RE = /^[a-z][a-z0-9-]{0,30}$/;

function parseCustomEngines(value: unknown): { engines: CustomEngineSpec[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "expected { engines: [...] }" };
  const engines: CustomEngineSpec[] = [];
  const slugs = new Set<string>();
  for (const item of value as Array<Record<string, unknown>>) {
    const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    const command = typeof item?.command === "string" ? item.command.trim() : "";
    const args = Array.isArray(item?.args) ? item.args : [];
    if (!SLUG_RE.test(slug))
      return { error: `invalid slug "${slug}" (lowercase letters, digits, -)` };
    if (slugs.has(slug)) return { error: `duplicate slug "${slug}"` };
    if (!label || label.length > 60) return { error: `engine "${slug}" needs a name` };
    if (!command) return { error: `engine "${slug}" needs a command` };
    // A program on this computer (a name on PATH or a local path), never one on a network share.
    const slashes = command.replace(/\\/g, "/");
    if (slashes.startsWith("//") || /^[a-z][a-z0-9+.-]*:\/\//i.test(command)) {
      return { error: `engine "${slug}" must run a program on this computer` };
    }
    if (!args.every((a): a is string => typeof a === "string")) {
      return { error: `engine "${slug}" args must be strings` };
    }
    slugs.add(slug);
    engines.push({ slug, label, command, args });
  }
  return { engines };
}
