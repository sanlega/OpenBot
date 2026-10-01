import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CoreContext } from "../../context.js";
import { MEMORY_FACT_MAX } from "../../memory.js";
import { requireAuth } from "../auth.js";
import { parseOrReject } from "../validation.js";

const MemoryEditBody = z.object({ content: z.string().trim().min(1).max(MEMORY_FACT_MAX) });

/**
 * C5: what each Bot remembers, for the owner to see, correct and delete ("What it knows").
 * Trust in a Bot's memory depends on being able to see and fix what it believes.
 */
export function registerMemoryRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/bots/:id/memories", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.bots.getById(id)) return reply.code(404).send({ error: "not_found" });
    return { memories: ctx.repos.memories.visibleTo(id) };
  });

  app.patch("/api/memories/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = parseOrReject(MemoryEditBody, request.body, reply);
    if (!body) return;
    const memory = ctx.repos.memories.getById(id);
    if (!memory) return reply.code(404).send({ error: "not_found" });
    ctx.repos.memories.updateContent(id, body.content, ctx.clock.now());
    await ctx.eventBus.publish({
      type: "memory.changed",
      botId: memory.botId,
      payload: { change: "edited", memoryId: id },
    });
    return { memory: ctx.repos.memories.getById(id) };
  });

  app.delete("/api/memories/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const memory = ctx.repos.memories.getById(id);
    if (!memory || !ctx.repos.memories.forget(id, ctx.clock.now())) {
      return reply.code(404).send({ error: "not_found" });
    }
    await ctx.eventBus.publish({
      type: "memory.changed",
      botId: memory.botId,
      payload: { change: "forgotten", memoryId: id },
    });
    return { ok: true };
  });
}
