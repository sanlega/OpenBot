import { newId, type Bot, type Message } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";

/**
 * Creates the Chief of Staff once setup is complete and none exists yet. It is
 * the first Bot the user talks to and the one that spawns the rest, so a fresh
 * install needs it. Synchronous up to the event publish: callers that run it
 * from a bus subscriber leave the Bot in the store before `setup/complete`
 * returns to the UI.
 */
export function ensureChiefOfStaff(ctx: CoreContext): Bot | undefined {
  if (!ctx.repos.setupState.get().completedAt) return undefined;
  const existing = ctx.repos.bots
    .list({ includeHidden: true, includeArchived: true })
    .find((bot) => bot.isChiefOfStaff);
  if (existing) return undefined;

  const bot: Bot = {
    id: newId("bot"),
    slug: "chief-of-staff",
    name: "Chief of Staff",
    description:
      "Your first point of contact. Handles work itself and creates Bots only when needed.",
    pinned: true,
    hidden: false,
    isChiefOfStaff: true,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "full",
    computer: "docker",
    connectors: [],
    limits: {},
  };
  ctx.repos.bots.create(bot);
  const threadId = newId("thread");
  const now = ctx.clock.now().toISOString();
  ctx.repos.threads.create({ id: threadId, botId: bot.id, kind: "dm", createdAt: now });
  // P2: the first thing a new owner sees is the Chief saying what it can do, written once
  // with the Chief itself (no engine turn: instant, free, the same on every engine).
  const greeting: Message = {
    id: newId("message"),
    threadId,
    author: { type: "bot", id: bot.id },
    text: FIRST_RUN_GREETING,
    attachments: [],
    hop: 0,
    createdAt: now,
    proactive: true,
    dedupeKey: GREETING_KEY,
    delivery: "delivered",
    pushed: false,
  };
  ctx.repos.messages.create(greeting);
  void ctx.eventBus.publish({ type: "bot.created", botId: bot.id, payload: { bot } });
  void ctx.eventBus
    .publish({
      type: "message.created",
      botId: bot.id,
      threadId,
      payload: {
        messageId: greeting.id,
        text: greeting.text,
        author: "bot",
        proactive: true,
        delivery: "delivered",
        dedupeKey: greeting.dedupeKey,
      },
    })
    .catch(() => undefined);
  return bot;
}

/** Marks the greeting message, so the Chief's first turn can be told about it. */
export const GREETING_KEY = "first-run-greeting";

export const FIRST_RUN_GREETING = [
  "Hi, I'm your Chief of Staff. Tell me what you need done and I'll see it through: I do quick things myself and set up a bot of its own for anything ongoing.",
  "",
  "A few things to try:",
  '- "Find the three best-reviewed CRMs for a small team and put a comparison in a file."',
  '- "Every Monday at 9, summarise what changed in my project folder."',
  "- \"Watch this product page and tell me when the price drops.\" (If a site needs you to sign in, I'll ask you to do it on the bot's screen.)",
  "",
  "I only stop for what only you can give (a sign-in, a code) or before I delete or pay for anything. You can watch any bot work in its Computer tab and follow every job in Tasks.",
].join("\n");
