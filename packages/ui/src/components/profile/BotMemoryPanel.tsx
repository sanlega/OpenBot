import { useCallback, useEffect, useRef, useState } from "react";
import type { Memory } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { shortTime } from "../common/time.js";

const TIER_LABEL: Record<Memory["tier"], string> = {
  profile: "Always remembered",
  log: "What happened",
  note: "Notes",
};

/** How long a deleted fact can be brought back before it is really deleted. */
export const UNDO_MS = 5000;

/**
 * C5: "What it knows" — every fact a Bot keeps across conversations (its own and the ones about
 * you that every Bot shares), so you can correct or delete what it believes.
 */
export function BotMemoryPanel({ botId }: { botId: string }) {
  const { transport, bots } = useOpenBot();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A deleted fact stays recoverable for a few seconds before the DELETE is sent.
  const [deleted, setDeleted] = useState<Memory | null>(null);
  const pending = useRef<{ memory: Memory; timer: ReturnType<typeof setTimeout> } | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());

  const load = useCallback(() => {
    setLoadFailed(false);
    transport
      .get<{ memories: Memory[] }>(`/api/bots/${botId}/memories`)
      .then((r) => setMemories(r.memories))
      .catch((err: unknown) => {
        console.warn("memories:", err);
        setLoadFailed(true);
      });
  }, [transport, botId]);

  useEffect(load, [load]);

  const commitDelete = useCallback(
    async (memory: Memory) => {
      try {
        await transport.delete(`/api/memories/${memory.id}`);
      } catch (err) {
        console.warn("delete memory:", err);
        setMemories((list) => (list ? [...list, memory] : list));
        setError("Couldn't delete that. It's back in the list; try again.");
      }
    },
    [transport],
  );

  // Leaving the panel finishes a pending delete rather than dropping it.
  useEffect(
    () => () => {
      const p = pending.current;
      if (p) {
        clearTimeout(p.timer);
        void commitDelete(p.memory);
      }
    },
    [commitDelete],
  );

  const remove = (memory: Memory) => {
    setError(null);
    const previous = pending.current;
    if (previous) {
      clearTimeout(previous.timer);
      void commitDelete(previous.memory);
    }
    setMemories((list) => list?.filter((m) => m.id !== memory.id) ?? null);
    setDeleted(memory);
    const timer = setTimeout(() => {
      pending.current = null;
      setDeleted(null);
      void commitDelete(memory);
    }, UNDO_MS);
    pending.current = { memory, timer };
  };

  const undo = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setDeleted(null);
    setMemories((list) => (list ? [...list, p.memory] : list));
  };

  const closeEditor = (id: string) => {
    setEditing(null);
    // Back to the Edit button it came from.
    setTimeout(() => editButtons.current.get(id)?.focus(), 0);
  };

  const save = async () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    setError(null);
    try {
      await transport.patch(`/api/memories/${editing.id}`, { content: text });
      setMemories(
        (list) => list?.map((m) => (m.id === editing.id ? { ...m, content: text } : m)) ?? null,
      );
      closeEditor(editing.id);
    } catch (err) {
      console.warn("save memory:", err);
      setError("Couldn't save that change. Try again.");
    }
  };

  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? "another bot";
  const sorted = (items: Memory[]) =>
    [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="settings-card bot-memory" data-testid="bot-memory-panel">
      <div className="settings-card-header">
        <h3>What it knows</h3>
        <p>
          What this bot remembers across conversations. Facts about you are shared by every bot. Fix
          or delete anything that is wrong.
        </p>
      </div>
      {loadFailed ? (
        <div className="memory-status" role="alert">
          <span>Couldn't load what this bot remembers.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      ) : memories === null ? (
        <p className="field-help">Loading…</p>
      ) : memories.length === 0 && !deleted ? (
        <p className="field-help">Nothing yet. Bots save facts as they learn them.</p>
      ) : null}
      {(["profile", "log", "note"] as const).map((tier) => {
        const items = sorted(memories?.filter((m) => m.tier === tier) ?? []);
        if (items.length === 0) return null;
        return (
          <section key={tier} className="memory-group">
            <h4>{TIER_LABEL[tier]}</h4>
            <ul className="memory-list">
              {items.map((m) => (
                <li key={m.id} className="memory-item">
                  {editing?.id === m.id ? (
                    <form
                      className="memory-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                      }}
                    >
                      <textarea
                        aria-label="Edit memory"
                        className="textarea"
                        value={editing.text}
                        rows={3}
                        maxLength={500}
                        autoFocus
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void save();
                          }
                          if (e.key === "Escape") closeEditor(m.id);
                        }}
                      />
                      <div className="memory-edit-actions">
                        <span className="memory-hint">Ctrl+Enter to save, Esc to cancel</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => closeEditor(m.id)}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={!editing.text.trim()}
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="memory-text">{m.content}</span>
                      <span className="memory-meta">
                        {m.scope === "user"
                          ? `About you · from ${m.botId === botId ? "this bot" : nameOf(m.botId)}`
                          : "This bot"}{" "}
                        · <time dateTime={m.createdAt}>{shortTime(m.createdAt)}</time>
                      </span>
                      <span className="memory-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Edit: ${m.content}`}
                          ref={(el) => {
                            editButtons.current.set(m.id, el);
                          }}
                          onClick={() => setEditing({ id: m.id, text: m.content })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Delete: ${m.content}`}
                          onClick={() => remove(m)}
                        >
                          Delete
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div aria-live="polite">
        {deleted ? (
          <div className="memory-status">
            <span>Deleted.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={undo}>
              Undo
            </button>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="memory-status memory-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
