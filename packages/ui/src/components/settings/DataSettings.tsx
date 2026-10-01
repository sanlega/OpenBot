import { useState } from "react";
import { useOpenBot } from "../../state/context.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { SettingRow, SettingsGroup } from "./SettingsPrimitives.js";

/** Settings > Data: start every conversation over, keeping the bots and their work. */
export function DataSettings() {
  const { transport, refresh } = useOpenBot();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const clearAll = async () => {
    const res = await transport.post<{ removed: number; threads: number }>(
      "/api/threads/clear-all",
      {},
    );
    await refresh();
    setDone(
      `Cleared ${res.threads} ${res.threads === 1 ? "chat" : "chats"} (${res.removed} ${res.removed === 1 ? "message" : "messages"}).`,
    );
  };

  return (
    <>
      <SettingsGroup title="Conversations">
        <SettingRow
          label="Clear all conversations"
          help={
            done ??
            "Removes every message and starts each bot on a fresh conversation. Bots, their instructions, files, routines and saved logins stay."
          }
        >
          <button
            type="button"
            className="btn btn-danger-solid btn-sm"
            onClick={() => {
              setDone(null);
              setConfirming(true);
            }}
          >
            Clear all…
          </button>
        </SettingRow>
        {confirming ? (
          <ConfirmDialog
            title="Clear every conversation?"
            confirmLabel="Clear all conversations"
            danger
            onConfirm={clearAll}
            onClose={() => setConfirming(false)}
          >
            <p>
              Every chat is emptied and each bot, the Chief of Staff included, forgets the
              conversation. This can&apos;t be undone. Your bots, their files, routines and saved
              logins are kept.
            </p>
          </ConfirmDialog>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="Start over">
        <ResetRow />
      </SettingsGroup>
    </>
  );
}

/** M2: start over completely, with a typed confirmation. */
function ResetRow() {
  const { transport, refresh } = useOpenBot();
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const reset = async () => {
    const res = await transport.post<{ bots: number; messages: number; memories: number }>(
      "/api/reset",
      { confirm: "RESET" },
    );
    await refresh();
    setDone(
      `OpenBot was reset: ${res.bots} ${res.bots === 1 ? "bot" : "bots"}, ${res.messages} messages and ${res.memories} memories removed.`,
    );
  };

  return (
    <>
      <SettingRow
        label="Reset OpenBot"
        help={
          done ??
          "Starts over: removes every bot except the Chief of Staff, all chats, memories, routines, tasks, approvals and permission rules. Keys, saved logins, connected apps, paired devices, settings and your workspace files stay."
        }
      >
        <button
          type="button"
          className="btn btn-danger-solid btn-sm"
          onClick={() => {
            setDone(null);
            setWord("");
            setConfirming(true);
          }}
        >
          Reset…
        </button>
      </SettingRow>
      {confirming ? (
        <ConfirmDialog
          title="Reset OpenBot?"
          confirmLabel="Reset OpenBot"
          danger
          confirmDisabled={word.trim().toUpperCase() !== "RESET"}
          onConfirm={reset}
          onClose={() => setConfirming(false)}
        >
          <p>
            Every bot except the Chief of Staff is removed, with all chats, memories, routines,
            tasks and approvals. This can&apos;t be undone. Your keys, saved logins, connected apps,
            devices, settings and workspace files are kept.
          </p>
          <label className="field">
            <span className="field-label">Type RESET to confirm</span>
            <input
              aria-label="Type RESET to confirm"
              value={word}
              autoComplete="off"
              onChange={(e) => setWord(e.target.value)}
            />
          </label>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
