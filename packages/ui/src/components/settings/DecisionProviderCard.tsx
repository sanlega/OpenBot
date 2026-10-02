import { useEffect, useState } from "react";
import type { DecisionSettings, Settings } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { friendlyError } from "../../api/errors.js";
import { SettingRow, SettingsGroup, StatusPill, Toggle } from "./SettingsPrimitives.js";

type Mode = DecisionSettings["mode"];

const MODES: Array<{ value: Mode; label: string; help: string }> = [
  {
    value: "jev",
    label: "Jev",
    help: "Every decision goes to Jev (TypeSafe). The most accurate, and the default.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    help: "Simple yes/no checks (new bots, notifications, risky steps) run on your own server; the computer and the rest stay on Jev. If your server doesn't answer, Jev does.",
  },
  {
    value: "local",
    label: "Local only",
    help: "Every decision runs on your own server, with no TypeSafe account. Less accurate on the computer's many-option choices; if the server stops, bots stop instead of guessing.",
  },
];

interface CheckResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  correct?: boolean;
  reason?: string;
}

/** What a check says, in one line. */
export function checkSummary(result: CheckResult): string {
  if (!result.ok) return result.reason ?? "It didn't answer.";
  const who = result.model ? `${result.model} answered` : "It answered";
  const ms = result.latencyMs;
  const speed =
    ms === undefined ? "" : ms < 1000 ? ` in ${ms} ms` : ` in ${(ms / 1000).toFixed(1)} s`;
  return result.correct === false
    ? `${who}${speed}, but got a simple test question wrong. It isn't fit to decide yet.`
    : `${who}${speed}, and got the test question right.`;
}

/**
 * D-037, Settings > Jev: where decisions are made (Jev, a local Jev-compatible server such as
 * Laya, or both), an optional image model for the computer's checks (ImaJev), and whether each
 * decision keeps what it saw so providers can be compared later.
 */
export function DecisionProviderCard({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (settings: Settings) => void;
}) {
  const { transport } = useOpenBot();
  const current = settings.decisions;
  const [mode, setMode] = useState<Mode>(current?.mode ?? "jev");
  const [localUrl, setLocalUrl] = useState(current?.localUrl ?? "");
  const [visionUrl, setVisionUrl] = useState(current?.visionUrl ?? "");
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checks, setChecks] = useState<
    Record<"text" | "vision", CheckResult | "checking" | undefined>
  >({
    text: undefined,
    vision: undefined,
  });
  const [usage, setUsage] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void transport
      .get<{ saved: boolean }>("/api/decisions/local-key")
      .then((r) => !cancelled && setKeySaved(r.saved))
      .catch(() => undefined);
    void transport
      .get<{ decisions: Array<{ provider: string }> }>("/api/decisions")
      .then((r) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const d of r.decisions ?? []) counts[d.provider] = (counts[d.provider] ?? 0) + 1;
        setUsage(counts);
      })
      .catch(() => !cancelled && setUsage(null));
    return () => {
      cancelled = true;
    };
  }, [transport, settings.updatedAt]);

  const dirty =
    mode !== (current?.mode ?? "jev") ||
    localUrl.trim() !== (current?.localUrl ?? "") ||
    visionUrl.trim() !== (current?.visionUrl ?? "") ||
    key.trim() !== "";

  const save = async (patch: Partial<Record<keyof DecisionSettings, unknown>>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (key.trim()) {
        await transport.put("/api/decisions/local-key", { key: key.trim() });
        setKey("");
        setKeySaved(true);
      }
      const res = await transport.patch<{ settings: Settings }>("/api/settings", {
        decisions: patch,
      });
      onSaved(res.settings);
      setNotice("Saved. New decisions use it now.");
      return true;
    } catch (err) {
      setError(friendlyError(err, "Couldn't save the decision settings."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const check = async (kind: "text" | "vision") => {
    const url = (kind === "text" ? localUrl : visionUrl).trim();
    if (!url) return;
    setChecks((c) => ({ ...c, [kind]: "checking" }));
    try {
      const res = await transport.post<CheckResult>("/api/decisions/check", {
        url,
        kind,
        ...(key.trim() ? { key: key.trim() } : {}),
      });
      setChecks((c) => ({ ...c, [kind]: res }));
    } catch (err) {
      setChecks((c) => ({
        ...c,
        [kind]: { ok: false, reason: friendlyError(err, "Couldn't run the check.") },
      }));
    }
  };

  const modeHelp = MODES.find((m) => m.value === mode)!.help;
  const needsServer = mode !== "jev" && !localUrl.trim();
  const total = usage ? Object.values(usage).reduce((a, b) => a + b, 0) : 0;
  const keep = current?.keepRequests ?? true;

  return (
    <>
      <SettingsGroup title="Decision model">
        <SettingRow label="Where decisions are made" help={modeHelp} stacked>
          <div className="segmented" role="radiogroup" aria-label="Where decisions are made">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                className="segmented-option"
                onClick={() => {
                  setMode(m.value);
                  setNotice(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label="Your decision server"
          help="A Jev-compatible server on this computer or your network, such as Laya (laya-serve, or Unsloth's Decision API). Its address, for example http://127.0.0.1:8000."
          htmlFor="decision-local-url"
          stacked
        >
          <div className="set-inline-field">
            <input
              id="decision-local-url"
              className="set-input"
              placeholder="http://127.0.0.1:8000"
              spellCheck={false}
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!localUrl.trim() || checks.text === "checking"}
              onClick={() => void check("text")}
            >
              {checks.text === "checking" ? "Checking…" : "Check connection"}
            </button>
          </div>
          {checks.text && checks.text !== "checking" ? (
            <p
              className={`set-check ${checks.text.ok && checks.text.correct !== false ? "set-check-ok" : "set-check-bad"}`}
              role="status"
            >
              {checkSummary(checks.text)}
            </p>
          ) : null}
        </SettingRow>
        <SettingRow
          label="Server key"
          help={
            keySaved
              ? "A key is saved in your local vault. Type a new one to replace it."
              : "Only if your server asks for one (laya-serve with LAYA_API_KEY, Unsloth's access token)."
          }
          htmlFor="decision-local-key"
        >
          <input
            id="decision-local-key"
            className="set-input"
            type="password"
            autoComplete="off"
            placeholder={keySaved ? "•••••••• (saved)" : "Optional"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Visual checks"
          help="Optional. A server that reads screenshots (ImaJev): when a computer task ends unsure, it looks at the screen to confirm the job is done or spot a sign-in page or CAPTCHA. It reads English goals best."
          htmlFor="decision-vision-url"
          stacked
        >
          <div className="set-inline-field">
            <input
              id="decision-vision-url"
              className="set-input"
              placeholder="http://127.0.0.1:8765"
              spellCheck={false}
              value={visionUrl}
              onChange={(e) => setVisionUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!visionUrl.trim() || checks.vision === "checking"}
              onClick={() => void check("vision")}
            >
              {checks.vision === "checking" ? "Checking…" : "Check connection"}
            </button>
          </div>
          {checks.vision && checks.vision !== "checking" ? (
            <p
              className={`set-check ${checks.vision.ok ? "set-check-ok" : "set-check-bad"}`}
              role="status"
            >
              {checkSummary(checks.vision)}
            </p>
          ) : null}
        </SettingRow>
        <div className="set-row set-row-actions">
          {needsServer ? (
            <span className="set-row-help">
              Add your server's address to use {mode === "local" ? "Local only" : "Hybrid"}.
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || busy || needsServer}
            onClick={() =>
              void save({ mode, localUrl: localUrl.trim(), visionUrl: visionUrl.trim() })
            }
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? (
          <div className="set-row-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice && !error ? (
          <div className="set-row-note" role="status">
            {notice}
          </div>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="Decision history">
        <SettingRow
          label="Keep what each decision saw"
          help="For 30 days, on this computer only, with passwords and keys removed. It lets you compare a local model with Jev on your own decisions (openbot decisions compare). Turning it off deletes what is kept."
        >
          <Toggle
            label="Keep what each decision saw"
            checked={keep}
            disabled={busy}
            onChange={(next) => void save({ keepRequests: next })}
          />
        </SettingRow>
        <SettingRow
          label="Latest decisions"
          help={
            usage === null
              ? "Couldn't load them."
              : total === 0
                ? "No decisions yet."
                : `Of the last ${total}: ${[
                    ["jev", "Jev"],
                    ["local", "your server"],
                    ["llm", "an engine stand-in"],
                    ["heuristic", "the safe fallback"],
                  ]
                    .filter(([p]) => usage[p!])
                    .map(([p, name]) => `${usage[p!]} by ${name}`)
                    .join(", ")}.`
          }
        >
          {usage && total > 0 ? (
            <StatusPill tone={usage.heuristic ? "warning" : "success"}>
              {usage.heuristic ? `${usage.heuristic} fallback` : "All answered"}
            </StatusPill>
          ) : null}
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
