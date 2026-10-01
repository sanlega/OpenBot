import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resetData } from "@openbot/store";
import type { CoreContext } from "../../context.js";
import { requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";

/** The owner types this word to confirm; a stray click or a script cannot reset by accident. */
export const RESET_WORD = "RESET";

const ResetBody = z.object({ confirm: z.literal(RESET_WORD) });

/**
 * M2: Settings > Data > Reset OpenBot. Starts over: removes every bot but the Chief of Staff,
 * every chat, memory, routine, task, approval and permission rule. Keys, logins, connected apps,
 * paired devices, settings and the workspace files stay.
 */
export function registerResetRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.post("/api/reset", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(ResetBody, request.body, reply);
    if (!body) return;
    const working = ctx.repos.turns.listOpen();
    if (working.length > 0) {
      const names = [
        ...new Set(working.map((t) => ctx.repos.bots.getById(t.botId)?.name ?? t.botId)),
      ];
      return reply
        .code(409)
        .send({ error: "busy", reason: `Still working: ${names.join(", ")}. Stop them first.` });
    }
    const roster = ctx.repos.bots.list({ includeHidden: true, includeArchived: true });
    const keep = roster.filter((b) => b.isChiefOfStaff && !b.archivedAt).map((b) => b.id);
    const gone = roster.filter((b) => !keep.includes(b.id) && !b.archivedAt);
    const counts = resetData(ctx.db, keep);
    for (const bot of gone) {
      await ctx.eventBus.publish({ type: "bot.archived", botId: bot.id, payload: { reset: true } });
    }
    for (const id of keep) {
      const thread = ctx.repos.threads.getByBotId(id);
      if (thread) {
        await ctx.eventBus.publish({
          type: "thread.cleared",
          botId: id,
          threadId: thread.id,
          payload: { removed: 0, reset: true },
        });
      }
    }
    return { ok: true, ...counts };
  });
}
