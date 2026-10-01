import { useEffect, useState } from "react";
import { ChevronRight, File, Folder, Terminal } from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { relativeTime } from "../activity/format.js";

interface Entry {
  name: string;
  kind: "dir" | "file" | "link";
  size: number;
  modifiedAt: string;
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

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * N2: the files bots and the VM share (/workspace inside it) and the bot's latest commands, so the
 * owner can see what a bot made without a terminal.
 */
export function WorkspaceFiles({ botId }: { botId: string }) {
  const { transport, state } = useOpenBot();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    transport
      .get<{ entries: Entry[] }>(`/api/workspace/files?path=${encodeURIComponent(path)}`)
      .then((r) => {
        if (!cancelled) {
          setEntries(Array.isArray(r.entries) ? r.entries : []);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setError("Couldn't read this folder.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transport, path]);

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

  const openFile = async (name: string) => {
    const file = path ? `${path}/${name}` : name;
    try {
      setPreview(
        await transport.get<Preview>(`/api/workspace/file?path=${encodeURIComponent(file)}`),
      );
    } catch {
      setError(`Couldn't open ${name}.`);
    }
  };

  const crumbs = path ? path.split("/") : [];

  return (
    <>
      <section className="settings-card" aria-label="Workspace files">
        <div className="settings-card-header">
          <h3>Files</h3>
          <p>
            The workspace this bot shares with you and the other bots (<code>/workspace</code> in
            the virtual machine).
          </p>
        </div>
        <nav className="files-crumbs" aria-label="Folder">
          <button type="button" className="files-crumb" onClick={() => setPath("")}>
            workspace
          </button>
          {crumbs.map((part, i) => (
            <span key={`${i}-${part}`} className="files-crumb-wrap">
              <ChevronRight size={12} aria-hidden />
              <button
                type="button"
                className="files-crumb"
                onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        {error ? (
          <div className="set-row-error" role="alert">
            {error}
          </div>
        ) : null}
        {entries === null ? (
          <p className="field-help">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="field-help">This folder is empty.</p>
        ) : (
          <ul className="files-list">
            {entries.map((e) => (
              <li key={e.name}>
                <button
                  type="button"
                  className="files-row"
                  onClick={() =>
                    e.kind === "file"
                      ? void openFile(e.name)
                      : (setPreview(null), setPath(path ? `${path}/${e.name}` : e.name))
                  }
                >
                  {e.kind === "dir" ? (
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
            ))}
          </ul>
        )}
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
            {commands.map((c, i) => (
              <li key={`${c.at}-${i}`}>
                <Terminal size={13} aria-hidden />
                <code className="files-command">{c.command}</code>
                <span className="files-meta">
                  {c.timedOut ? (
                    <span className="pill pill-warning">timed out</span>
                  ) : c.exitCode === undefined ? null : (
                    <span className={`pill pill-${c.exitCode === 0 ? "success" : "danger"}`}>
                      {c.exitCode === 0 ? "ok" : `exit ${c.exitCode ?? "?"}`}
                    </span>
                  )}
                  <time dateTime={c.at}>{relativeTime(c.at)}</time>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
