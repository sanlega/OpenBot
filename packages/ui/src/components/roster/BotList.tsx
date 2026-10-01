import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Bot } from "@openbot/contracts";
import { Eraser, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ThreadView } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar, type BotStatus } from "../common/BotAvatar.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { shortTime } from "../common/time.js";
import { plainText } from "../activity/format.js";
import { friendlyError } from "../../api/errors.js";

interface BotListProps {
  creating?: boolean;
  onCreatingChange?: (creating: boolean) => void;
  /** Called after a Bot is picked (e.g. to show the thread on phones). */
  onSelect?: () => void;
  /** Only mark the open thread when the chat is what's on screen. */
  highlightSelection?: boolean;
}

export function BotList({
  creating = false,
  onCreatingChange,
  onSelect,
  highlightSelection = true,
}: BotListProps) {
  const { bots, threads, selectedThreadId, selectThread, pendingApprovals, state, transport } =
    useOpenBot();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "clear" | "delete"; bot: Bot } | null>(null);

  const statusOf = (botId: string): BotStatus => {
    if (pendingApprovals.some((a) => a.botId === botId)) return "needs-you";
    if ([...state.inputs.values()].some((i) => i.botId === botId && i.status === "pending")) {
      return "needs-you";
    }
    if ([...state.turns.values()].some((t) => t.botId === botId && t.status === "running")) {
      return "working";
    }
    return "idle";
  };

  const rows = threads
    .map((thread) => ({ thread, bot: bots.find((b) => b.id === thread.botId) }))
    .filter((r): r is { thread: ThreadView; bot: Bot } => Boolean(r.bot && !r.bot.archivedAt));
  const chief = rows.filter((r) => r.bot.isChiefOfStaff);
  const team = rows
    .filter((r) => !r.bot.isChiefOfStaff)
    .sort((a, b) => (b.thread.lastMessageAt ?? "").localeCompare(a.thread.lastMessageAt ?? ""));

  const renderRow = ({ thread, bot }: { thread: ThreadView; bot: Bot }) => {
    const status = statusOf(bot.id);
    const active = highlightSelection && selectedThreadId === thread.id;
    return (
      <div
        key={thread.id}
        className="bot-row"
        data-menu-open={menuFor === bot.id || undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuFor(bot.id);
        }}
      >
        {renaming === bot.id ? (
          <RenameForm bot={bot} onDone={() => setRenaming(null)} />
        ) : (
          <button
            type="button"
            className="bot-item"
            data-active={active}
            aria-current={active ? "page" : undefined}
            data-status={status}
            onClick={() => {
              selectThread(thread.id);
              onSelect?.();
            }}
          >
            <BotAvatar bot={bot} size={32} status={status} />
            <span className="bot-meta">
              <span className="bot-name-row">
                <span className="bot-name">{bot.name}</span>
                {status === "needs-you" ? (
                  <span className="pill pill-warning">Needs you</span>
                ) : thread.lastMessageAt ? (
                  <span className="bot-time">{shortTime(thread.lastMessageAt)}</span>
                ) : null}
              </span>
              <span className="bot-preview">
                {status === "working"
                  ? "Working…"
                  : thread.lastMessagePreview
                    ? `${thread.lastMessageAuthor === "user" ? "You: " : ""}${plainText(thread.lastMessagePreview)}`
                    : (bot.label ?? bot.description)}
              </span>
            </span>
          </button>
        )}
        {renaming === bot.id ? null : (
          <button
            type="button"
            className="bot-row-more"
            aria-label={`More actions for ${bot.name}`}
            aria-haspopup="menu"
            aria-expanded={menuFor === bot.id}
            onClick={() => setMenuFor(menuFor === bot.id ? null : bot.id)}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {menuFor === bot.id ? (
          <BotMenu
            bot={bot}
            onClose={() => setMenuFor(null)}
            onRename={() => setRenaming(bot.id)}
            onClear={() => setConfirm({ kind: "clear", bot })}
            onDelete={() => setConfirm({ kind: "delete", bot })}
          />
        ) : null}
      </div>
    );
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const thread = threads.find((t) => t.botId === confirm.bot.id);
    if (confirm.kind === "clear") {
      if (thread) await transport.post(`/api/threads/${thread.id}/clear`, {});
      return;
    }
    await transport.delete(`/api/bots/${confirm.bot.id}`);
    if (thread && selectedThreadId === thread.id) {
      const next = rows.find((r) => r.bot.id !== confirm.bot.id);
      selectThread(next?.thread.id ?? null);
    }
  };

  return (
    <div className="bot-list" data-testid="bot-list">
      {creating ? <NewBotForm onDone={() => onCreatingChange?.(false)} /> : null}
      {chief.map(renderRow)}
      {team.length > 0 ? <div className="roster-section">Team</div> : null}
      {team.map(renderRow)}
      {rows.length === 0 && !creating ? (
        <div className="roster-empty">
          <p>No bots yet.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onCreatingChange?.(true)}
          >
            Create a bot
          </button>
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={
            confirm.kind === "clear"
              ? `Clear the chat with ${confirm.bot.name}?`
              : `Delete ${confirm.bot.name}?`
          }
          confirmLabel={confirm.kind === "clear" ? "Clear chat" : "Delete bot"}
          danger
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        >
          {confirm.kind === "clear" ? (
            <p>
              Its messages are removed and it starts a fresh conversation. Its instructions, files,
              routines and saved logins stay.
            </p>
          ) : (
            <p>
              {confirm.bot.name} leaves the team and its chat leaves the sidebar. The Chief of Staff
              keeps a note of what it did, and its files stay in the workspace.
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** Rename, clear chat, delete: from the "⋯" button or a right-click on the row. */
function BotMenu({
  bot,
  onClose,
  onRename,
  onClear,
  onDelete,
}: {
  bot: Bot;
  onClose: () => void;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      // Arrow keys move between the items, as in any menu.
      const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
      e.preventDefault();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const item = (label: string, icon: ReactNode, run: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className="bot-menu-item"
      data-danger={danger || undefined}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="bot-menu" role="menu" aria-label={`${bot.name} actions`} ref={ref}>
      {item("Rename", <Pencil size={14} />, onRename)}
      {item("Clear chat", <Eraser size={14} />, onClear)}
      {bot.isChiefOfStaff ? null : item("Delete bot", <Trash2 size={14} />, onDelete, true)}
    </div>
  );
}

function RenameForm({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const { transport } = useOpenBot();
  const [name, setName] = useState(bot.name);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving.current) return;
    const next = name.trim();
    if (!next || next === bot.name) return onDone();
    saving.current = true;
    try {
      await transport.patch(`/api/bots/${bot.id}`, { name: next });
      onDone();
    } catch (err) {
      saving.current = false;
      setError(friendlyError(err, "Couldn't rename."));
    }
  };
  return (
    <form className="bot-rename" onSubmit={(e) => void save(e)}>
      <BotAvatar bot={bot} size={32} status="idle" />
      <input
        aria-label={`New name for ${bot.name}`}
        value={name}
        autoFocus
        maxLength={60}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        aria-invalid={error ? true : undefined}
      />
      {error ? <span className="form-error">{error}</span> : null}
    </form>
  );
}

function NewBotForm({ onDone }: { onDone: () => void }) {
  const { transport, refresh, selectThread } = useOpenBot();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await transport.post<{ thread: { id: string } }>("/api/bots", {
        name: name.trim(),
        description: description.trim(),
      });
      await refresh();
      selectThread(res.thread.id);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "Couldn't create the bot."));
      setBusy(false);
    }
  };

  return (
    <form
      className="new-bot-form"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <div className="new-bot-title">New bot</div>
      <input
        aria-label="Bot name"
        placeholder="Name, e.g. Researcher"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <textarea
        aria-label="Bot description"
        placeholder="What is it for? This becomes its standing instructions."
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error ? <span className="form-error">{error}</span> : null}
      <div className="new-bot-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
          Create
        </button>
      </div>
    </form>
  );
}
