import { useEffect, useState } from "react";
import type { BoxDiagnostics } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { SettingRow, SettingsGroup, StatusPill } from "./SettingsPrimitives.js";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

const COMPONENT_LABEL: Record<string, string> = {
  xvfb: "display",
  wm: "window manager",
  vnc: "live view",
  browser: "browser",
};

/**
 * Settings > Computer: the machine's self-check (A7) and the first recovery to try. Each check is
 * one PASS/FAIL line, so the owner can tell whether the machine needs a refresh (a new machine
 * that keeps files and sign-ins) or the image reset below.
 */
export function ComputerHealthCard() {
  const { transport } = useOpenBot();
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
      setError(errorText(err, "Could not run the self-check."));
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
      setError(errorText(err, "Could not refresh the computer."));
    } finally {
      setRefreshing(false);
    }
  };

  const failed = report?.checks.filter((c) => !c.ok) ?? [];
  const busy = running || refreshing;

  return (
    <SettingsGroup title="Health">
      <SettingRow
        label="Self-check"
        help="Checks the virtual machine: browser, live view, internet, clock, workspace, and that bots stay confined."
      >
        <div className="set-inline-actions">
          {report ? (
            <StatusPill tone={report.ok ? "success" : "danger"}>
              {report.ok ? "All good" : `${failed.length} problem${failed.length === 1 ? "" : "s"}`}
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
      {report ? (
        <ul className="set-checklist" aria-label="Self-check results">
          {report.checks.map((c) => (
            <li key={c.name} data-ok={c.ok ? "true" : "false"}>
              <StatusPill tone={c.ok ? "success" : "danger"}>{c.ok ? "Pass" : "Fail"}</StatusPill>
              <span className="set-checklist-name">{c.name}</span>
              <span className="set-checklist-detail">{c.detail}</span>
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
                    Screen :{s.display} {COMPONENT_LABEL[c.name] ?? c.name}
                  </span>
                  <span className="set-checklist-detail">
                    {c.restartsInWindow} restart{c.restartsInWindow === 1 ? "" : "s"} in 10 min
                    {c.downReason ? ` (${c.downReason})` : ""}
                  </span>
                </li>
              )),
          )}
        </ul>
      ) : null}
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
