import type { Approval, Bot } from "@openbot/contracts";
import { ShieldCheck, ShieldX, Clock } from "lucide-react";
import { approvalAction, approvalTarget, botNamer } from "../activity/format.js";
import { clockTime } from "../common/time.js";

/** What you decided on an approval, left in the chat once the card is gone. */
export function ApprovalNote({
  approval,
  resolvedAt,
  bots,
}: {
  approval: Approval;
  resolvedAt?: string;
  bots: Bot[];
}) {
  const names = botNamer(bots);
  const allowed = approval.resolution === "allow";
  const expired = approval.status === "expired" || approval.resolution === "expired";
  const verb = expired ? "Expired" : allowed ? "You allowed" : "You denied";
  const target = approvalTarget(approval);
  return (
    <div
      className="msg msg-system approval-note"
      data-resolution={expired ? "expired" : allowed ? "allow" : "deny"}
      data-testid={`approval-note-${approval.id}`}
    >
      {expired ? (
        <Clock size={13} aria-hidden />
      ) : allowed ? (
        <ShieldCheck size={13} aria-hidden />
      ) : (
        <ShieldX size={13} aria-hidden />
      )}
      <span>
        <strong>{verb}</strong>: {approvalAction(approval, names.humanize)}
        {target ? (
          <>
            {" "}
            <code>{target.length > 60 ? `${target.slice(0, 57)}…` : target}</code>
          </>
        ) : null}
      </span>
      {resolvedAt ? <span className="msg-time">{clockTime(resolvedAt)}</span> : null}
    </div>
  );
}
