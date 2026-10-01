import { useMemo, useState } from "react";
import type { Approval } from "@openbot/contracts";
import { ShieldAlert } from "lucide-react";
import { useOptionalOpenBot } from "../../state/context.js";
import {
  approvalAction,
  approvalTarget,
  botNamer,
  humanReason,
  parseApproval,
} from "../activity/format.js";
import { friendlyError } from "../../api/errors.js";

interface ApprovalCardProps {
  approval: Approval;
  onResolve: (resolution: "allow" | "deny") => void;
}

const KIND_TITLES: Record<Approval["kind"], string> = {
  tool: "Review an action",
  computer_action: "Review a computer action",
  connector_action: "Review an app action",
  chain_limit: "Keep going?",
  bot_request: "A bot needs your OK",
  local_computer: "Use this computer?",
  routine_live: "Turn on this routine?",
};

const SHELL_TOOLS = new Set(["Bash", "shell", "exec_command", "local_shell"]);
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch"]);

/**
 * C2: "Always allow" proposes the narrowest rule that covers what was asked: this exact command,
 * this exact file, or (for anything else) the tool.
 */
export function proposedRule(
  tool: string,
  input: Record<string, unknown> | undefined,
): { match: { tool: string; args?: Record<string, unknown> }; label: string } {
  const command = typeof input?.command === "string" ? input.command : undefined;
  if (SHELL_TOOLS.has(tool) && command) {
    return {
      match: { tool, args: { command } },
      label: "Always allow runs this exact command without asking again.",
    };
  }
  const file = typeof input?.file_path === "string" ? input.file_path : undefined;
  if (FILE_TOOLS.has(tool) && file) {
    return {
      match: { tool, args: { file_path: file } },
      label: `Always allow lets this bot change ${file} without asking again.`,
    };
  }
  return {
    match: { tool },
    label: "Always allow lets this bot do this kind of action without asking again.",
  };
}

export function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  const openbot = useOptionalOpenBot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => botNamer(openbot?.bots ?? []), [openbot?.bots]);
  const { tool, input, reason: rawReason } = parseApproval(approval);
  const headline = approvalAction(approval, names.humanize);
  const reason = rawReason ? names.humanize(humanReason(rawReason)) : undefined;
  const target = approvalTarget(approval);
  const rule = tool ? proposedRule(tool, input) : undefined;

  const alwaysAllow = async () => {
    if (!openbot || !tool) return;
    setBusy(true);
    try {
      await openbot.transport.post("/api/rules", {
        scope: approval.botId,
        match: rule?.match ?? { tool },
        effect: "allow",
      });
      onResolve("allow");
    } catch (err) {
      setError(friendlyError(err, "Couldn't save the rule."));
      setBusy(false);
    }
  };

  return (
    <article className="approval-card" data-testid={`approval-${approval.id}`}>
      <header className="approval-header">
        <ShieldAlert size={16} aria-hidden />
        <h3>{KIND_TITLES[approval.kind]}</h3>
      </header>
      <p className="approval-headline">{headline}</p>
      {target ? <pre className="approval-command">{target}</pre> : null}
      {input || reason ? (
        <details className="approval-details">
          <summary>Details</summary>
          {input ? <pre>{JSON.stringify(input, null, 2)}</pre> : null}
          {reason ? <p className="approval-reason">{reason}</p> : null}
        </details>
      ) : null}
      {approval.risk !== undefined ? (
        <p className="approval-risk">
          Risk: {approval.risk < 0.34 ? "low" : approval.risk < 0.67 ? "medium" : "high"}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="approval-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onResolve("allow")}
        >
          {tool ? "Allow once" : "Allow"}
        </button>
        {tool && openbot ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void alwaysAllow()}
            aria-describedby={`${approval.id}-scope`}
          >
            Always allow
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onResolve("deny")}
        >
          Deny
        </button>
      </div>
      {tool && openbot && rule ? (
        <p className="approval-scope" id={`${approval.id}-scope`}>
          {rule.label}
        </p>
      ) : null}
    </article>
  );
}
