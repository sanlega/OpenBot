import { useEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, RefreshCw, Terminal } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { relativeTime } from "../activity/format.js";
import { MessageText } from "../thread/MessageText.js";

interface Entry {
  name: string;
  kind: "dir" | "file" | "link";
  /** For a link: what it opens as inside the workspace, or "outside" (not opened). */
  target?: "dir" | "file" | "outside";
  size: number;
  modifiedAt: string;
}

/** How a row opens: a link opens as what it points to inside the workspace. */
function opensAs(e: Entry): "dir" | "file" | undefined {
  if (e.kind !== "link") return e.kind;
  return e.target === "dir" || e.target === "file" ? e.target : undefined;
}

interface Preview {
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  text?: string;
}

interface Command {
  command: string;
  at: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

/** How often, at most, the open folder is read again while bots work. */
const REFRESH_MS = 3000;

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** How a command ended, in the words the other status pills use. */
export function commandOutcome(c: Command): { label: string; tone: string } | null {
  if (c.timedOut) return { label: "Timed out", tone: "warning" };
  if (c.exitCode === undefined) return null;
  if (c.exitCode === 0) return { label: "Done", tone: "success" };
  return { label: `Failed (exit ${c.exitCode ?? "?"})`, tone: "danger" };
}

/**
 * N2: the files bots and the VM share (/workspace inside it) and the bot's latest commands, so the
 * owner can see what a bot made without a terminal.
 */
export function WorkspaceFiles({ botId }: { botId: string }) {
  const { transport, state } = useOpenBot();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const lastRead = useRef(0);
  const shownPath = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A new folder starts from "Loading…"; a refresh of the same one keeps the list on screen.
    if (shownPath.current !== path) setEntries(null);
    lastRead.current = Date.now();
    transport
      .get<{ entries: Entry[] }>(`/api/workspace/files?path=${encodeURIComponent(path)}`)
      .then((r) => {
        if (cancelled) return;
        shownPath.current = path;
        setEntries(Array.isArray(r.entries) ? r.entries : []);
        setLoadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [transport, path, reloads]);

  // Files a bot writes show up while you watch: the folder is read again as events arrive.
  useEffect(() => {
    if (!state?.lastSeq) return;
    const wait = Math.max(0, REFRESH_MS - (Date.now() - lastRead.current));
    const timer = setTimeout(() => setReloads((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [state?.lastSeq]);

  // The latest commands, refreshed as the bot works.
  useEffect(() => {
    const timer = setTimeout(() => {
      transport
        .get<{ commands: Command[] }>(`/api/bots/${botId}/commands`)
        .then((r) => setCommands(Array.isArray(r.commands) ? r.commands : []))
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [transport, botId, state?.lastSeq]);

  const go = (next: string) => {
    setPreview(null);
    setOpenError(null);
    setPath(next);
  };

  const openFile = async (name: string) => {
    const file = path ? `${path}/${name}` : name;
    try {
      setPreview(
        await transport.get<Preview>(`/api/workspace/file?path=${encodeURIComponent(file)}`),
      );
      setOpenError(null);
    } catch {
      setOpenError(`Couldn't open ${name}. It may be in use; try again in a moment.`);
    }
  };

  const crumbs = path ? path.split("/") : [];
  const isMarkdown = preview ? /\.(md|markdown)$/i.test(preview.path) : false;

  return (
    <>
      <section className="settings-card" aria-label="Workspace files">
        <div className="settings-card-header files-header">
          <div>
            <h3>Files</h3>
            <p>
              The workspace this bot shares with you and the other bots (<code>/workspace</code> in
              the virtual machine).
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Refresh files"
            title="Refresh"
            onClick={() => setReloads((n) => n + 1)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <nav className="files-crumbs" aria-label="Folder">
          <button
            type="button"
            className="files-crumb"
            aria-current={crumbs.length === 0 ? "page" : undefined}
            onClick={() => go("")}
          >
            <FolderOpen size={13} aria-hidden /> workspace
          </button>
          {crumbs.map((part, i) => (
            <span key={`${i}-${part}`} className="files-crumb-wrap">
              <ChevronRight size={12} aria-hidden />
              <button
                type="button"
                className="files-crumb"
                aria-current={i === crumbs.length - 1 ? "page" : undefined}
                onClick={() => go(crumbs.slice(0, i + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        {loadFailed && entries === null ? (
          <div className="screen-error" role="alert">
            Couldn&apos;t read this folder.
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setReloads((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        ) : entries === null ? (
          <p className="field-help">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="field-help">This folder is empty.</p>
        ) : (
          <ul className="files-list">
            {entries.map((e) => {
              const as = opensAs(e);
              return (
                <li key={e.name}>
                  <button
                    type="button"
                    className="files-row"
                    disabled={!as}
                    title={!as ? "A link to somewhere outside the workspace" : undefined}
                    onClick={() =>
                      as === "file"
                        ? void openFile(e.name)
                        : go(path ? `${path}/${e.name}` : e.name)
                    }
                  >
                    {as === "dir" ? (
                      <Folder size={15} aria-hidden />
                    ) : (
                      <File size={15} aria-hidden />
                    )}
                    <span className="files-name">{e.name}</span>
                    <span className="files-meta">
                      {e.kind === "file" ? sizeLabel(e.size) : ""}
                      <time dateTime={e.modifiedAt}>{relativeTime(e.modifiedAt)}</time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {loadFailed && entries !== null ? (
          <p className="field-help" role="status">
            Couldn&apos;t refresh this folder; the list may be out of date.
          </p>
        ) : null}
        {openError ? (
          <div className="screen-error" role="alert">
            {openError}
          </div>
        ) : null}
        {preview ? (
          <div className="files-preview">
            <div className="files-preview-head">
              <strong>{preview.path}</strong>
              <span>{sizeLabel(preview.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
            {preview.binary ? (
              <p className="field-help">
                This file isn&apos;t text, so it can&apos;t be shown here.
              </p>
            ) : isMarkdown ? (
              <div className="files-markdown">
                <MessageText text={preview.text ?? ""} markdown />
              </div>
            ) : (
              <pre className="files-text">{preview.text}</pre>
            )}
            {preview.truncated ? (
              <p className="field-help">Only the beginning of this file is shown.</p>
            ) : null}
          </div>
        ) : null}
      </section>
      {commands.length > 0 ? (
        <section className="settings-card" aria-label="Recent commands">
          <div className="settings-card-header">
            <h3>Recent commands</h3>
            <p>What this bot ran in the virtual machine, newest first.</p>
          </div>
          <ul className="files-commands">
            {commands.map((c, i) => {
              const outcome = commandOutcome(c);
              return (
                <li key={`${c.at}-${i}`}>
                  <Terminal size={13} aria-hidden />
                  <code className="files-command">{c.command}</code>
                  <span className="files-meta">
                    {outcome ? (
                      <span className={`pill pill-${outcome.tone}`}>{outcome.label}</span>
                    ) : null}
                    <time dateTime={c.at}>{relativeTime(c.at)}</time>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
