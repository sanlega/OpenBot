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
  );
}
