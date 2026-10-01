import { useEffect, useState } from "react";
import type { BoxDiagnostics } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { SettingRow, SettingsGroup, StatusPill } from "./SettingsPrimitives.js";
import { friendlyError } from "../../api/errors.js";

const COMPONENT_LABEL: Record<string, string> = {
  xvfb: "display",
  wm: "window manager",
  vnc: "live view",
  browser: "browser",
};

/** Each self-check in plain words: what it is, and what to do when it fails. */
const CHECKS: Record<string, { label: string; fail: string }> = {
  "machine-id": { label: "Machine identity", fail: "Refresh the computer below." },
  browser: { label: "Browser", fail: "Refresh the computer below." },
  "browser file descriptors": {
    label: "Browser resources",
    fail: "The browser is running out of room. Refresh the computer below.",
  },
  internet: { label: "Internet", fail: "Check this computer's connection, then run it again." },
  clock: { label: "Clock", fail: "The time is off, so some sites may refuse to sign in." },
  workspace: { label: "Shared files", fail: "Bots can't save files. Refresh the computer below." },
  isolation: {
    label: "Bots stay inside the machine",
    fail: "Refresh the computer below; if it stays, reset the image.",
  },
  firewall: { label: "Network guard", fail: "Refresh the computer below." },
  disk: { label: "Free space", fail: "Delete large files from the workspace." },
  "memory pressure": {
    label: "Memory",
    fail: "Too much is running. Stop a bot's task or refresh the computer.",
  },
};

function checkLabel(name: string, screenOwner: (display: number) => string): string {
  const screen = /^screen :(\d+)$/.exec(name);
  if (screen) return `${screenOwner(Number(screen[1]))}'s screen`;
  return CHECKS[name]?.label ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function checkSummary(name: string, ok: boolean): string {
  if (ok) return "Working";
  if (/^screen :/.test(name)) return "Not responding. Refresh the computer below.";
  return CHECKS[name]?.fail ?? "Not working. Refresh the computer below.";
}

/**
 * Settings > Computer: the machine's self-check (A7) and the first recovery to try. Each check is
 * one PASS/FAIL line, so the owner can tell whether the machine needs a refresh (a new machine
 * that keeps files and sign-ins) or the image reset below.
 */
export function ComputerHealthCard() {
  const { transport, bots } = useOpenBot();
  const [wired, setWired] = useState(false);
  const [report, setReport] = useState<BoxDiagnostics | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void transport
      .get<{ provider?: string }>("/api/computer/status")
      .then((s) => {
        if (!cancelled && s.provider === "docker") setWired(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [transport]);

  if (!wired) return null;

  const check = async () => {
    setError(null);
    setRunning(true);
    try {
      setReport(await transport.get<BoxDiagnostics>("/api/computer/diagnose"));
    } catch (err) {
      setError(friendlyError(err, "Couldn't run the self-check."));
    } finally {
      setRunning(false);
    }
  };

  const refresh = async () => {
    setConfirming(false);
    setError(null);
    setRefreshing(true);
    try {
      await transport.post("/api/computer/recreate", {});
      await check();
    } catch (err) {
      setError(friendlyError(err, "Couldn't refresh the computer."));
    } finally {
      setRefreshing(false);
    }
  };

  // A crashing or stopped part of a screen is a problem too: the count matches the red rows.
  const brokenParts =
    report?.screens.flatMap((x) => x.components.filter((c) => c.crashloop || !c.up)) ?? [];
  const problems = (report?.checks.filter((c) => !c.ok).length ?? 0) + brokenParts.length;
  const screenOwner = (display: number) => {
    const botId = report?.screens.find((x) => x.display === display)?.botId;
    return bots.find((b) => b.id === botId)?.name ?? "A bot";
  };
  const busy = running || refreshing;

  return (
    <SettingsGroup title="Health">
      <SettingRow
        label="Self-check"
        help="Checks the virtual machine: browser, live view, internet, clock, workspace, and that bots stay confined."
      >
        <div className="set-inline-actions">
          {report ? (
            <StatusPill tone={problems === 0 ? "success" : "danger"}>
              {problems === 0 ? "All good" : `${problems} problem${problems === 1 ? "" : "s"}`}
            </StatusPill>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void check()}
          >
            {running ? "Checking…" : "Run self-check"}
          </button>
        </div>
      </SettingRow>
      {/* Always rendered, so screen readers announce the results when they arrive. */}
      <div aria-live="polite">
        {report ? (
          <ul className="set-checklist" aria-label="Self-check results">
            {report.checks.map((c) => (
              <li key={c.name} data-ok={c.ok ? "true" : "false"}>
                <StatusPill tone={c.ok ? "success" : "danger"}>{c.ok ? "Pass" : "Fail"}</StatusPill>
                <span className="set-checklist-name">{checkLabel(c.name, screenOwner)}</span>
                <span className="set-checklist-detail">
                  {checkSummary(c.name, c.ok)}
                  {!c.ok && c.detail ? (
                    <details className="set-checklist-tech">
                      <summary>Technical details</summary>
                      <code>{c.detail}</code>
                    </details>
                  ) : null}
                </span>
              </li>
            ))}
            {report.screens.map((s) =>
              s.components
                .filter((c) => c.restartsInWindow > 0 || !c.up || c.crashloop)
                .map((c) => (
                  <li
                    key={`${s.display}-${c.name}`}
                    data-ok={c.up && !c.crashloop ? "true" : "false"}
                  >
                    <StatusPill tone={c.crashloop ? "danger" : c.up ? "warning" : "danger"}>
                      {c.crashloop ? "Crashing" : c.up ? "Restarted" : "Down"}
                    </StatusPill>
                    <span className="set-checklist-name">
                      {screenOwner(s.display)}'s {COMPONENT_LABEL[c.name] ?? c.name}
                    </span>
                    <span className="set-checklist-detail">
                      {c.restartsInWindow === 0
                        ? "Stopped"
                        : `Restarted ${c.restartsInWindow} time${c.restartsInWindow === 1 ? "" : "s"} in the last 10 minutes`}
                      {c.downReason ? (
                        <details className="set-checklist-tech">
                          <summary>Technical details</summary>
                          <code>{c.downReason}</code>
                        </details>
                      ) : null}
                    </span>
                  </li>
                )),
            )}
          </ul>
        ) : null}
      </div>
      <SettingRow
        label="Refresh the computer"
        help="Starts a new virtual machine. Files and sign-ins are kept; anything running in it stops."
      >
        <div className="set-inline-actions">
          {confirming ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh now
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </SettingRow>
      {error ? (
        <div className="set-row-error" role="alert">
          {error}
        </div>
      ) : null}
    </SettingsGroup>
  );
}
