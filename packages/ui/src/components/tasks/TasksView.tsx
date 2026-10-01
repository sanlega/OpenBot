import { useEffect, useMemo, useRef, useState } from "react";
import type { Delegation } from "@openbot/contracts";
import { ArrowRight, ChevronRight, ListChecks } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar } from "../common/BotAvatar.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { fullTime, relativeTime } from "../activity/format.js";
import { friendlyError } from "../../api/errors.js";

export type TaskRow = Delegation & {
  requesterName?: string;
  assigneeName?: string;
  depth?: number;
};

type Filter = "open" | "all";

const OPEN = new Set(["submitted", "working", "input_required"]);

const STATE_LABEL: Record<Delegation["state"], { label: string; tone: string }> = {
  submitted: { label: "Handed over", tone: "muted" },
  working: { label: "Working", tone: "accent" },
  input_required: { label: "Waiting for an answer", tone: "warning" },
  completed: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  interrupted: { label: "Stopped", tone: "muted" },
};

/**
 * L3: the task board. What each bot handed to another, where it stands and what came back; an
 * open task can be cancelled, with the tasks its worker handed on (L1).
 */
export function TasksView() {
  const { transport, bots, state } = useOpenBot();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const loadRef = useRef<() => void>(() => undefined);
  const lastLoad = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  loadRef.current = () => {
    lastLoad.current = Date.now();
    void transport
      .get<{ tasks: TaskRow[] }>("/api/tasks")
      .then((r) => {
        setTasks(r.tasks ?? []);
        setLoadFailed(false);
      })
      .catch(() => {
        setLoadFailed(true);
        setTasks((t) => t ?? []);
      });
  };
  useEffect(() => loadRef.current(), []);
  // Live, but at most every 2 s: a streaming reply emits many events, and a debounce would keep
  // the board from ever refreshing while a bot writes.
  useEffect(() => {
    if (state.lastSeq === 0 || pending.current) return;
    const wait = Math.max(0, 2_000 - (Date.now() - lastLoad.current));
    pending.current = setTimeout(() => {
      pending.current = undefined;
      loadRef.current();
    }, wait);
  }, [state.lastSeq]);
  useEffect(() => () => clearTimeout(pending.current), []);

  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const visible = (tasks ?? []).filter((t) => filter === "all" || OPEN.has(t.state));
  const openCount = (tasks ?? []).filter((t) => OPEN.has(t.state)).length;

  const cancel = async (id: string) => {
    if (cancelling) return;
    setError(null);
    setCancelling(id);
    try {
      await transport.post(`/api/tasks/${id}/cancel`, {});
      setConfirming(null);
      loadRef.current();
    } catch (err) {
      setError(friendlyError(err, "Could not cancel the task."));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="screen" data-testid="tasks-view">
      <ScreenHeader
        title="Tasks"
        subtitle="What your bots handed to each other, and where each task stands"
      />
      <div className="screen-body">
        <div className="screen-content screen-content-wide">
          <div className="feed-toolbar">
            <div className="filter-tabs" role="group" aria-label="Filter tasks">
              <button
                type="button"
                className="filter-tab"
                aria-pressed={filter === "open"}
                onClick={() => setFilter("open")}
              >
                In progress{openCount ? ` (${openCount})` : ""}
              </button>
              <button
                type="button"
                className="filter-tab"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
            </div>
          </div>
          {error ? (
            <div className="set-row-error" role="alert">
              {error}
            </div>
          ) : null}
          {tasks === null ? (
            <div className="feed-skeleton" aria-hidden>
              <span />
              <span />
            </div>
          ) : loadFailed && (tasks ?? []).length === 0 ? (
            <div className="empty-block">
              <ListChecks size={22} aria-hidden />
              <p className="empty-title">Couldn’t load the tasks</p>
              <p className="empty-text">Check the connection to OpenBot and try again.</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadRef.current()}
              >
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-block">
              <ListChecks size={22} aria-hidden />
              <p className="empty-title">
                {filter === "open" ? "No task in progress" : "No tasks yet"}
              </p>
              <p className="empty-text">
                When the Chief of Staff or a bot hands work to another bot, it shows up here with
                its result.
              </p>
            </div>
          ) : (
            <ul className="task-list" aria-label="Tasks">
              {visible.map((t) => {
                const s = STATE_LABEL[t.state];
                const isOpen = open === t.id;
                const from = botById.get(t.requesterBotId);
                const to = botById.get(t.assigneeBotId);
                return (
                  <li key={t.id} className="task-item" data-state={t.state}>
                    <button
                      type="button"
                      className="task-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : t.id)}
                    >
                      <span className="task-bots">
                        {from ? <BotAvatar bot={from} size={22} motion="none" /> : null}
                        <span className="task-bot-name">{t.requesterName ?? "A bot"}</span>
                        <ArrowRight size={13} aria-hidden />
                        {to ? <BotAvatar bot={to} size={22} motion="none" /> : null}
                        <span className="task-bot-name">{t.assigneeName ?? "A bot"}</span>
                      </span>
                      <span className="task-title">{t.title}</span>
                      <span className="task-meta">
                        <time dateTime={t.updatedAt} title={fullTime(t.updatedAt)}>
                          {relativeTime(t.updatedAt)}
                        </time>
                        <span className={`pill pill-${s.tone}`}>{s.label}</span>
                        <ChevronRight size={14} className="audit-chevron" aria-hidden />
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="task-details">
                        {t.statusMessage ? <p className="task-status">{t.statusMessage}</p> : null}
                        {t.result ? <pre className="task-result">{t.result}</pre> : null}
                        <dl>
                          <dt>Handed over</dt>
                          <dd>{fullTime(t.createdAt)}</dd>
                          <dt>Messages back and forth</dt>
                          <dd>{t.roundTrips}</dd>
                          {t.depth && t.depth > 1 ? (
                            <>
                              <dt>Hand-offs from you</dt>
                              <dd>{t.depth}</dd>
                            </>
                          ) : null}
                        </dl>
                        {OPEN.has(t.state) ? (
                          <div className="set-inline-actions">
                            {confirming === t.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setConfirming(null)}
                                >
                                  Keep it
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={cancelling === t.id}
                                  onClick={() => void cancel(t.id)}
                                >
                                  {cancelling === t.id ? "Cancelling…" : "Cancel task"}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setConfirming(t.id)}
                              >
                                Cancel…
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
