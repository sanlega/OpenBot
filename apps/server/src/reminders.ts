import type { Bot } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";

/**
 * C4: short reminders the harness adds to the message an engine receives, from what OpenBot
 * knows and the engine cannot: its last turn was cut short, a card or a form is still waiting
 * for the user. They ride in the user message, so they work the same on every engine.
 */
export function harnessReminders(ctx: CoreContext, bot: Bot): string[] {
  const reminders: string[] = [];
  const last = ctx.repos.turns
    .listByBot(bot.id)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .at(-1);
  if (last?.status === "interrupted" || last?.status === "failed") {
    reminders.push(
      `Your previous turn ${last.status === "interrupted" ? "was interrupted" : "failed"} before it finished. ` +
        "Follow the new message first. Then complete anything still unfinished from earlier " +
        "turns, checking what is already done, unless the user asked you to stop.",
    );
  }
  // K2: a card nobody answered because the turn ended is not a refusal.
  // Only cards closed before their deadline (the turn ended first): one that timed out after 30
  // minutes of no answer is old news, and asking again every turn would nag.
  const since = last?.createdAt ?? "";
  const now = ctx.clock.now().toISOString();
  const unanswered = ctx.repos.approvals
    .list({ botId: bot.id })
    .filter(
      (a) =>
        a.resolution === "expired" &&
        a.kind !== "bot_request" &&
        a.createdAt >= since &&
        a.expiresAt > now,
    )
    .slice(0, 3);
  if (unanswered.length > 0) {
    reminders.push(
      `Not answered (your turn ended first), so NOT refused by the user: ${unanswered
        .map((a) => `"${a.summary}"`)
        .join(
          ", ",
        )}. If it is still needed and the user did not stop you, run it again and it will ask again.`,
    );
  }
  const cards = ctx.repos.approvals.list({ status: "pending", botId: bot.id }).slice(0, 3);
  if (cards.length > 0) {
    reminders.push(
      `Waiting for the user's approval: ${cards.map((c) => `"${c.summary}"`).join(", ")}. ` +
        "Do not ask again for the same action; it runs (or is refused) when they answer.",
    );
  }
  const forms = ctx.repos.inputRequests.list({ status: "pending", botId: bot.id }).slice(0, 3);
  if (forms.length > 0) {
    reminders.push(
      `Your form${forms.length === 1 ? "" : "s"} ${forms.map((f) => `"${f.title}"`).join(", ")} ` +
        `${forms.length === 1 ? "is" : "are"} still waiting for the user's answer; the answers ` +
        "arrive as their message. Do not ask the same questions again.",
    );
  }
  return reminders;
}

/** The engine's message: reminders first (marked as the harness's, not the user's), then the text. */
export function withReminders(text: string, reminders: string[]): string {
  if (reminders.length === 0) return text;
  return `<system_reminder>\n${reminders.map((r) => `- ${r}`).join("\n")}\n</system_reminder>\n\n${text}`;
}

/** A message the user sent while the bot was working (steered into the running turn). */
export function steerText(text: string): string {
  return withReminders(text, [
    "The user sent this while you were working. Follow it first; then finish the unfinished " +
      "parts of your task unless the user asked you to stop.",
  ]);
}
