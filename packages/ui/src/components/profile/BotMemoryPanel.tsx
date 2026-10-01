import { useCallback, useEffect, useState } from "react";
import type { Memory } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";

const TIER_LABEL: Record<Memory["tier"], string> = {
  profile: "Always remembered",
  log: "What happened",
  note: "Notes",
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * C5: "What it knows" — every fact a Bot keeps across conversations (its own and the ones about
 * you that every Bot shares), so you can correct or delete what it believes.
 */
export function BotMemoryPanel({ botId }: { botId: string }) {
  const { transport, bots } = useOpenBot();
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    transport
      .get<{ memories: Memory[] }>(`/api/bots/${botId}/memories`)
      .then((r) => setMemories(r.memories))
      .catch((err) => setError(errorText(err, "Could not load what this bot remembers.")));
  }, [transport, botId]);

  useEffect(load, [load]);

  const remove = async (id: string) => {
    setError(null);
    try {
      await transport.delete(`/api/memories/${id}`);
      setMemories((list) => list?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setError(errorText(err, "Could not delete that memory."));
    }
  };

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      await transport.patch(`/api/memories/${editing.id}`, { content: editing.text });
      setMemories(
        (list) =>
          list?.map((m) => (m.id === editing.id ? { ...m, content: editing.text.trim() } : m)) ??
          null,
      );
      setEditing(null);
    } catch (err) {
      setError(errorText(err, "Could not save that change."));
    }
  };

  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? "another bot";

  return (
    <div className="settings-card bot-memory" data-testid="bot-memory-panel">
      <div className="settings-card-header">
        <h3>What it knows</h3>
        <p>
          What this bot remembers across conversations. Facts about you are shared by every bot. Fix
          or delete anything that is wrong.
        </p>
      </div>
      {memories === null && !error ? <p className="field-help">Loading…</p> : null}
      {memories?.length === 0 ? (
        <p className="field-help">Nothing yet. Bots save facts as they learn them.</p>
      ) : null}
      {(["profile", "log", "note"] as const).map((tier) => {
        const items = memories?.filter((m) => m.tier === tier) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={tier} className="memory-group">
            <h4>{TIER_LABEL[tier]}</h4>
            <ul className="memory-list">
              {items.map((m) => (
                <li key={m.id} className="memory-item">
                  {editing?.id === m.id ? (
                    <div className="memory-edit field">
                      <input
                        aria-label="Edit memory"
                        value={editing.text}
                        maxLength={500}
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!editing.text.trim()}
                        onClick={() => void save()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="memory-text">{m.content}</span>
                      <span className="memory-meta">
                        {m.scope === "user"
                          ? `About you · from ${m.botId === botId ? "this bot" : nameOf(m.botId)}`
                          : "This bot"}{" "}
                        · {new Date(m.createdAt).toLocaleDateString()}
                      </span>
                      <span className="memory-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing({ id: m.id, text: m.content })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Delete: ${m.content}`}
                          onClick={() => void remove(m.id)}
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
      {error ? (
        <div className="set-row-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
