import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { delegationsOf } from "../../delegations.js";
import { requireAuth, requireOwner } from "../auth.js";

/**
 * L3: the task board. Every task one bot handed to another, newest first, with who asked, who
 * works on it, where it stands and what came back; the owner can cancel an open one (L1).
 */
export function registerTaskRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/tasks", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tracker = delegationsOf(ctx);
    const tasks = ctx.repos.delegations
      .list({})
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 200)
      .map((d) => ({
        ...d,
        requesterName: ctx.repos.bots.getById(d.requesterBotId)?.name,
        assigneeName: ctx.repos.bots.getById(d.assigneeBotId)?.name,
        depth: d.depth ?? tracker.depthOf(d.requesterBotId) + 1,
      }));
    return { tasks };
  });

  app.post("/api/tasks/:id/cancel", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.delegations.getById(id)) return reply.code(404).send({ error: "not_found" });
    const cancelled = await delegationsOf(ctx).cancel(id, { name: "you" });
    if (cancelled.length === 0) {
      return reply.code(409).send({ error: "not_open", reason: "that task already ended" });
    }
    return { cancelled: cancelled.map((d) => d.id) };
  });
}
