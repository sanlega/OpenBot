import type { Memory, MemoryScope, MemoryTier } from "@openbot/contracts";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Db } from "./db.js";
import { memories } from "./schema.js";

type MemoryRow = typeof memories.$inferSelect;

/** C5: Bots' persistent memory. Forgetting keeps the row (audit trail) and hides it for good. */
export class MemoriesRepo {
  constructor(private readonly db: Db) {}

  create(memory: Memory): void {
    this.db
      .insert(memories)
      .values({
        id: memory.id,
        scope: memory.scope,
        botId: memory.botId,
        tier: memory.tier,
        content: memory.content,
        sourceChainId: memory.sourceChainId,
        createdAt: new Date(memory.createdAt),
        updatedAt: new Date(memory.updatedAt),
      })
      .run();
  }

  getById(id: string): Memory | undefined {
    const row = this.db
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), isNull(memories.forgottenAt)))
      .get();
    return row ? toMemory(row) : undefined;
  }

  /**
   * What a Bot can see: its own `bot` memories and every `user` memory, newest first.
   * `botId` unset lists every live memory (Settings).
   */
  visibleTo(botId?: string, filter: { tier?: MemoryTier; scope?: MemoryScope } = {}): Memory[] {
    const conditions = [isNull(memories.forgottenAt)];
    if (botId) {
      const own = or(eq(memories.scope, "user"), eq(memories.botId, botId));
      if (own) conditions.push(own);
    }
    if (filter.tier) conditions.push(eq(memories.tier, filter.tier));
    if (filter.scope) conditions.push(eq(memories.scope, filter.scope));
    return this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.createdAt))
      .all()
      .map(toMemory);
  }

  updateContent(id: string, content: string, now: Date): void {
    this.db
      .update(memories)
      .set({ content, updatedAt: now })
      .where(and(eq(memories.id, id), isNull(memories.forgottenAt)))
      .run();
  }

  forget(id: string, now: Date): boolean {
    const result = this.db
      .update(memories)
      .set({ forgottenAt: now })
      .where(and(eq(memories.id, id), isNull(memories.forgottenAt)))
      .run();
    return result.changes > 0;
  }
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    botId: row.botId,
    tier: row.tier as MemoryTier,
    content: row.content,
    ...(row.sourceChainId ? { sourceChainId: row.sourceChainId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
