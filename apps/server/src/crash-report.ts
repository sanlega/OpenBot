import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";

/** Written by the desktop app when the harness exits without being asked to (D3). */
const MARKER = "harness-crash.json";

interface Marker {
  class?: string;
  code?: number | null;
  exitedAt?: string;
  uptimeMs?: number;
}

/**
 * D3: if the previous harness died unexpectedly, tell the owner once, in the Chief of Staff's
 * chat, with what is known and where to look. The marker is kept as `.reported` for a bug report.
 */
export async function reportPreviousCrash(ctx: CoreContext): Promise<boolean> {
  const file = join(ctx.config.openbotHome, "logs", MARKER);
  let marker: Marker;
  try {
    marker = JSON.parse(readFileSync(file, "utf8")) as Marker;
  } catch {
    return false;
  }
  try {
    renameSync(file, `${file}.reported`);
  } catch {
    // Reported anyway; it may be reported again next time.
  }
  const chief = ctx.repos.bots.list().find((b) => b.isChiefOfStaff && !b.archivedAt);
  const thread = chief ? ctx.repos.threads.getByBotId(chief.id) : undefined;
  if (!chief || !thread) return false;
  const when = marker.exitedAt
    ? new Date(marker.exitedAt).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "recently";
  const how =
    marker.class === "signal_exit"
      ? "it was stopped by the system"
      : `it exited with code ${marker.code ?? "unknown"}`;
  const text =
    `OpenBot closed unexpectedly at ${when} (${how}) and restarted on its own. ` +
    "Anything a bot was doing then was interrupted; the bots pick it up when you message them. " +
    "If it keeps happening, Settings > Computer > Self-check shows the computer's diagnostics " +
    "for a bug report.";
  const now = ctx.clock.now().toISOString();
  ctx.repos.messages.create({
    id: newId("message"),
    threadId: thread.id,
    author: { type: "system" },
    text,
    attachments: [],
    hop: 0,
    createdAt: now,
    proactive: false,
    delivery: "delivered",
    pushed: false,
  });
  await ctx.eventBus
    .publish({
      type: "message.created",
      botId: chief.id,
      threadId: thread.id,
      payload: { text, author: "system" },
    })
    .catch(() => undefined);
  return true;
}
