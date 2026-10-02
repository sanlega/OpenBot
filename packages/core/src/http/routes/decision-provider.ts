import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CoreContext } from "../../context.js";
import { requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";

/** Where the local decision server's key lives (D-037); same name as the server's VAULT_KEYS. */
export const LOCAL_DECISIONS_KEY = "decisions.localKey";

const CheckBody = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://"),
  /** A key typed in the form; otherwise the saved one. */
  key: z.string().optional(),
  /** "vision": the probe sends a small picture (an image decision server). */
  kind: z.enum(["text", "vision"]).default("text"),
});

const KeyBody = z.object({ key: z.string().max(500) });

/** A 2×2 white JPEG: enough for an image decision server to prove it reads pictures. */
const PROBE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** The time a check may take: a local model's first answer loads it (seconds on a CPU). */
const CHECK_TIMEOUT_MS = 60_000;

/**
 * D-037, Settings > Jev: "Check connection" asks the server one tiny decision whose answer is
 * known, and says which model answered, how fast, and whether it got it right.
 */
export function registerDecisionProviderRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.post("/api/decisions/check", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(CheckBody, request.body, reply);
    if (!body) return;
    const key = body.key?.trim() || (await ctx.vault.get(LOCAL_DECISIONS_KEY)) || "local";
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(`${body.url.replace(/\/$/, "")}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          state: { note: "The sky is blue and the grass is green." },
          questions: {
            sky: { type: "noul", instructions: "Does `note` say the sky is blue?" },
          },
          ...(body.kind === "vision" ? { images: [`data:image/jpeg;base64,${PROBE_JPEG}`] } : {}),
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return {
          ok: false,
          reason:
            res.status === 401 || res.status === 403
              ? "The server wants a key. Add it below and check again."
              : `The server answered with an error (HTTP ${res.status}).`,
          latencyMs,
        };
      }
      const data = (await res.json().catch(() => undefined)) as
        { model?: unknown; answers?: { sky?: { type?: string; noul?: unknown } } } | undefined;
      const noul = data?.answers?.sky?.noul;
      if (typeof noul !== "number") {
        return {
          ok: false,
          reason: "It answered, but not like a Jev-compatible decision server.",
          latencyMs,
        };
      }
      return {
        ok: true,
        model: typeof data?.model === "string" ? data.model : undefined,
        latencyMs,
        // The probe's right answer is "yes": a server that gets it wrong isn't fit to decide.
        correct: noul >= 0.5,
      };
    } catch (error) {
      return {
        ok: false,
        reason:
          (error as Error).name === "AbortError"
            ? "No answer within a minute. Is the model still loading?"
            : "Nothing answers at that address. Is the server running?",
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  });

  app.get("/api/decisions/local-key", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return { saved: Boolean(await ctx.vault.get(LOCAL_DECISIONS_KEY)) };
  });

  app.put("/api/decisions/local-key", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(KeyBody, request.body, reply);
    if (!body) return;
    if (body.key.trim()) await ctx.vault.set(LOCAL_DECISIONS_KEY, body.key.trim());
    else await ctx.vault.delete(LOCAL_DECISIONS_KEY);
    return { saved: Boolean(body.key.trim()) };
  });
}
