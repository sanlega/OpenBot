import { inArray, notInArray } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  approvals,
  bots,
  capCounters,
  chains,
  computerTasks,
  decisions,
  delegations,
  engineSessions,
  inputRequests,
  memories,
  messages,
  routineRuns,
  routines,
  rules,
  threads,
  triggerEvents,
  turns,
} from "./schema.js";

export interface ResetCounts {
  bots: number;
  messages: number;
  memories: number;
  routines: number;
  tasks: number;
}

/**
 * M2: "Reset OpenBot". Everything bots did and know goes, in one transaction: the other bots,
 * every chat, memories, routines and their runs, tasks between bots, approvals, permission rules,
 * engine sessions and the decision log. What the owner set up stays: the bots in `keepBotIds`
 * (the Chief of Staff, with an empty chat), keys and logins (the vault), connected apps, paired
 * devices, settings and setup, and the workspace files (not in the database).
 */
export function resetData(db: Db, keepBotIds: string[]): ResetCounts {
  return db.transaction((tx) => {
    const keep = keepBotIds.length > 0 ? keepBotIds : ["__none__"];
    const gone = tx
      .select({ id: bots.id })
      .from(bots)
      .where(notInArray(bots.id, keep))
      .all()
      .map((b) => b.id);
    const counts: ResetCounts = {
      bots: gone.length,
      messages: tx.delete(messages).run().changes,
      memories: tx.delete(memories).run().changes,
      routines: tx.delete(routines).run().changes,
      tasks: tx.delete(delegations).run().changes,
    };
    tx.delete(routineRuns).run();
    tx.delete(triggerEvents).run();
    tx.delete(inputRequests).run();
    tx.delete(approvals).run();
    tx.delete(rules).run();
    tx.delete(turns).run();
    tx.delete(chains).run();
    tx.delete(computerTasks).run();
    tx.delete(engineSessions).run();
    tx.delete(decisions).run();
    tx.delete(capCounters).run();
    if (gone.length > 0) {
      tx.delete(threads).where(inArray(threads.botId, gone)).run();
      tx.delete(bots).where(inArray(bots.id, gone)).run();
    }
    return counts;
  });
}
