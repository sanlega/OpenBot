import {
  newId,
  type Bot,
  type Memory,
  type MemoryScope,
  type MemoryTier,
} from "@openbot/contracts";
import type { CoreContext } from "./context.js";

/** Longest fact a Bot can save, in characters. */
export const MEMORY_FACT_MAX = 500;
/** Live memories one Bot may hold (its own plus the user ones it wrote). */
export const MEMORY_MAX_PER_BOT = 300;
/** Characters of memory in a Bot's prompt (about 2,000 tokens). */
export const MEMORY_PROMPT_BUDGET = 8_000;
/** `log` entries (what happened) shown in the prompt; older ones are found with recall. */
const PROMPT_LOGS = 10;

/** Things that must never be stored as a fact: keys, tokens, passwords. */
const SECRET_RE =
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(password|passwd|contrase[nñ]a|api[ _-]?key|secret|token)\s*[:=]\s*\S{6,}/i;

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export type RememberResult =
  { ok: true; memory: Memory; existed: boolean } | { ok: false; reason: string };

/** C5: saves a fact for a Bot (or, with `user` scope, for every Bot). */
export function rememberFact(
  ctx: CoreContext,
  input: {
    botId: string;
    fact: string;
    tier?: MemoryTier;
    scope?: MemoryScope;
    chainId?: string;
  },
): RememberResult {
  const content = input.fact.trim().replace(/\s+/g, " ");
  if (!content) return { ok: false, reason: "the fact is empty" };
  if (content.length > MEMORY_FACT_MAX) {
    return {
      ok: false,
      reason: `a fact is at most ${MEMORY_FACT_MAX} characters: keep it to one line`,
    };
  }
  if (SECRET_RE.test(content)) {
    return {
      ok: false,
      reason:
        "that looks like a password, key or token: secrets go to the vault (save_login), never to memory",
    };
  }
  const visible = ctx.repos.memories.visibleTo(input.botId);
  const same = visible.find((m) => normal(m.content) === normal(content));
  if (same) return { ok: true, memory: same, existed: true };
  if (visible.filter((m) => m.botId === input.botId).length >= MEMORY_MAX_PER_BOT) {
    return {
      ok: false,
      reason: `memory is full (${MEMORY_MAX_PER_BOT} facts): forget outdated ones first`,
    };
  }
  const now = ctx.clock.now().toISOString();
  const memory: Memory = {
    id: newId("memory"),
    // The narrowest scope by default.
    scope: input.scope ?? "bot",
    botId: input.botId,
    tier: input.tier ?? "profile",
    content,
    ...(input.chainId ? { sourceChainId: input.chainId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  ctx.repos.memories.create(memory);
  return { ok: true, memory, existed: false };
}

/** Forgets a fact the Bot can see, by its exact text (or its id). */
export function forgetFact(
  ctx: CoreContext,
  botId: string,
  fact: string,
): { ok: true; forgotten: Memory } | { ok: false; reason: string } {
  const wanted = normal(fact);
  const match = ctx.repos.memories
    .visibleTo(botId)
    .find((m) => m.id === fact.trim() || normal(m.content) === wanted);
  if (!match) {
    return { ok: false, reason: "no remembered fact has exactly that text: use recall to find it" };
  }
  ctx.repos.memories.forget(match.id, ctx.clock.now());
  return { ok: true, forgotten: match };
}

/** Finds facts by words (every tier, including notes that are not in the prompt). */
export function recallFacts(ctx: CoreContext, botId: string, query: string, limit = 10): Memory[] {
  const terms = normal(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  const visible = ctx.repos.memories.visibleTo(botId);
  if (terms.length === 0) return visible.slice(0, limit);
  return visible
    .map((m) => {
      const text = normal(m.content);
      return { m, score: terms.filter((t) => text.includes(t)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.m.createdAt < b.m.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.m);
}

function line(m: Memory, botId: string): string {
  const day = m.createdAt.slice(0, 10);
  const source = m.scope === "user" ? "about the user" : m.botId === botId ? "you" : "another bot";
  return `- (learned ${day}) [${source}] ${m.content}`;
}

/**
 * The memory section of a Bot's prompt: everything it knows about itself and the user (profile),
 * then what happened lately (log), newest first, within a budget. Dates and sources help the
 * model judge how much to trust a fact.
 */
export function memoryPromptBlock(
  ctx: CoreContext,
  bot: Pick<Bot, "id">,
  budget = MEMORY_PROMPT_BUDGET,
): string {
  const visible = ctx.repos.memories.visibleTo(bot.id);
  const profile = visible.filter((m) => m.tier === "profile");
  const logs = visible.filter((m) => m.tier === "log").slice(0, PROMPT_LOGS);
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const m of [...profile, ...logs]) {
    const text = line(m, bot.id);
    if (used + text.length > budget) {
      dropped += 1;
      continue;
    }
    lines.push(text);
    used += text.length + 1;
  }
  const rules = MEMORY_RULES;
  if (lines.length === 0) return `${rules}\nYou have no saved memories yet.`;
  return [
    rules,
    "What you remember:",
    ...lines,
    ...(dropped > 0 ? [`(${dropped} more not shown: use recall to search them.)`] : []),
  ].join("\n");
}

export const MEMORY_RULES = `MEMORY
You keep facts across conversations with remember({fact, tier, scope}). Save what will matter
later: the user's preferences and standing instructions, who people are, how you do this job,
decisions taken. One short line per fact. tier: "profile" for durable facts (always shown to
you), "log" for what happened (latest shown), "note" for details found with recall({query}).
scope: "bot" (default) is yours; "user" is a fact about the user that every bot should know.
Never save passwords, keys, codes or card numbers (they go to the vault). When a fact is wrong
or outdated, forget({fact}) with its exact text, then remember the new one. Never say you will
remember something unless you called remember.`;
