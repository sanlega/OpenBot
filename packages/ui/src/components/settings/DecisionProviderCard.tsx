import { useEffect, useState, type ReactNode } from "react";
import type { DecisionSettings, Settings } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { friendlyError } from "../../api/errors.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { onRadioArrows } from "../common/radio-keys.js";
import { SettingRow, SettingsGroup, Toggle } from "./SettingsPrimitives.js";

type Mode = DecisionSettings["mode"];
type CheckKind = "text" | "vision";

const MODES: Array<{ value: Mode; label: string; help: string }> = [
  {
    value: "jev",
    label: "Jev",
    help: "Every decision goes to Jev, by TypeSafe. The most accurate choice, and the default.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    help: "Simple yes/no checks (new bots, notifications) run on a decision server you run yourself; risky steps, the computer and everything else stay on Jev. If your server doesn't answer, Jev does.",
  },
  {
    value: "local",
    label: "Local only",
    help: "Every decision runs on a decision server you run yourself, with no TypeSafe account. It is less accurate on the computer's choices, and if the server stops, bots stop and tell you.",
  },
];
const MODE_VALUES = MODES.map((m) => m.value);

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

const passed = (r: CheckResult | undefined) => Boolean(r?.ok && r.correct !== false);

/** A row whose field takes the full width under its label. */
function BlockRow({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="set-row set-row-block">
      <div className="set-row-text">
        <label className="set-row-label" htmlFor={htmlFor}>
          {label}
        </label>
        <div className="set-row-help">{help}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * D-037, Settings > Jev: where decisions are made (Jev, a decision server the owner runs such
 * as Laya, or both), an optional server that reads screenshots for the computer's checks
 * (ImaJev), and whether each decision keeps what it saw so providers can be compared later.
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
  const [modelMessage, setModelMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );
  const [historyMessage, setHistoryMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );
  const [confirmForget, setConfirmForget] = useState(false);
  const [checks, setChecks] = useState<Record<CheckKind, CheckResult | "checking" | undefined>>({
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

  const usesServer = mode !== "jev";
  const dirty =
    mode !== (current?.mode ?? "jev") ||
    localUrl.trim() !== (current?.localUrl ?? "") ||
    visionUrl.trim() !== (current?.visionUrl ?? "") ||
    key.trim() !== "";
  const needsServer = usesServer && !localUrl.trim();

  const forget = (kind: CheckKind) => setChecks((c) => ({ ...c, [kind]: undefined }));

  const runCheck = async (kind: CheckKind): Promise<CheckResult | undefined> => {
    const url = (kind === "text" ? localUrl : visionUrl).trim();
    if (!url) return undefined;
    setChecks((c) => ({ ...c, [kind]: "checking" }));
    let result: CheckResult;
    try {
      result = await transport.post<CheckResult>("/api/decisions/check", {
        url,
        kind,
        ...(key.trim() ? { key: key.trim() } : {}),
      });
    } catch (err) {
      result = { ok: false, reason: friendlyError(err, "Couldn't run the check.") };
    }
    setChecks((c) => ({ ...c, [kind]: result }));
    return result;
  };

  const saveModel = async () => {
    setModelMessage(null);
    // Local only has no other model to fall back on: the server must answer, and answer right.
    if (mode === "local") {
      const result = checks.text === "checking" ? undefined : checks.text;
      const check = passed(result) ? result : await runCheck("text");
      if (!passed(check)) {
        setModelMessage({
          tone: "bad",
          text: "Local only wasn't saved: your decision server has to pass the check first, or bots would stop deciding.",
        });
        return;
      }
    }
    setBusy(true);
    try {
      if (key.trim()) {
        await transport.put("/api/decisions/local-key", { key: key.trim() });
        setKey("");
        setKeySaved(true);
      }
      const res = await transport.patch<{ settings: Settings }>("/api/settings", {
        decisions: { mode, localUrl: localUrl.trim(), visionUrl: visionUrl.trim() },
      });
      onSaved(res.settings);
      setChecks({ text: undefined, vision: undefined });
      setModelMessage({ tone: "ok", text: "Saved. New decisions use it now." });
    } catch (err) {
      setModelMessage({
        tone: "bad",
        text: friendlyError(err, "Couldn't save the decision model."),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveHistory = async (keep: boolean) => {
    setHistoryMessage(null);
    setBusy(true);
    try {
      const res = await transport.patch<{ settings: Settings }>("/api/settings", {
        decisions: { keepRequests: keep },
      });
      onSaved(res.settings);
      setHistoryMessage({
        tone: "ok",
        text: keep
          ? "New decisions keep what they saw, for 30 days."
          : "Off. What was kept is deleted, and new decisions keep nothing.",
      });
    } catch (err) {
      setHistoryMessage({ tone: "bad", text: friendlyError(err, "Couldn't change it.") });
    } finally {
      setBusy(false);
    }
  };

  const checkLine = (kind: CheckKind) => {
    const c = checks[kind];
    return (
      <p
        className={`set-check ${c && c !== "checking" ? ((kind === "text" ? passed(c) : c.ok) ? "set-check-ok" : "set-check-bad") : ""}`}
        aria-live="polite"
      >
        {c === "checking" ? "Checking…" : c ? checkSummary(c) : ""}
      </p>
    );
  };

  const modeHelp = MODES.find((m) => m.value === mode)!.help;
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
                tabIndex={mode === m.value ? 0 : -1}
                className="segmented-option"
                onClick={() => {
                  setMode(m.value);
                  setModelMessage(null);
                }}
                onKeyDown={(e) =>
                  onRadioArrows(e, MODE_VALUES, mode, (v) => {
                    setMode(v);
                    setModelMessage(null);
                  })
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </SettingRow>
        {usesServer ? (
          <>
            <BlockRow
              label="Your decision server"
              htmlFor="decision-local-url"
              help="The address of a decision server you run yourself, for example Laya."
            >
              <div className="set-inline-field">
                <input
                  id="decision-local-url"
                  className="set-input"
                  placeholder="e.g. http://127.0.0.1:8000"
                  spellCheck={false}
                  value={localUrl}
                  onChange={(e) => {
                    setLocalUrl(e.target.value);
                    forget("text");
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label="Check decision server"
                  disabled={!localUrl.trim() || checks.text === "checking"}
                  onClick={() => void runCheck("text")}
                >
                  Check connection
                </button>
              </div>
              {checkLine("text")}
            </BlockRow>
            <SettingRow
              label="Server key"
              help={
                keySaved
                  ? "A key is saved on this computer. Type a new one to replace it."
                  : "Only if your server asks for one."
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
                onChange={(e) => {
                  setKey(e.target.value);
                  forget("text");
                  forget("vision");
                }}
              />
            </SettingRow>
          </>
        ) : null}
        <BlockRow
          label="Visual checks"
          htmlFor="decision-vision-url"
          help={
            <>
              Optional, with any of the choices above. The address of a server that reads
              screenshots, such as ImaJev: when a computer task ends unsure, it looks at the screen
              to confirm the job is done or to spot a sign-in page or CAPTCHA. It reads goals
              written in English best
              {keySaved || key.trim() ? ", and uses the server key above" : ""}.
            </>
          }
        >
          <div className="set-inline-field">
            <input
              id="decision-vision-url"
              className="set-input"
              placeholder="e.g. http://127.0.0.1:8765"
              spellCheck={false}
              value={visionUrl}
              onChange={(e) => {
                setVisionUrl(e.target.value);
                forget("vision");
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-label="Check visual checks server"
              disabled={!visionUrl.trim() || checks.vision === "checking"}
              onClick={() => void runCheck("vision")}
            >
              Check connection
            </button>
          </div>
          {checkLine("vision")}
        </BlockRow>
        <details className="set-row set-details">
          <summary>How to run a decision server</summary>
          <p>
            Laya runs on this computer with Unsloth&apos;s Decision API, or with{" "}
            <code>laya-serve</code> from <code>pip install &quot;laya[serve]&quot;</code>; its
            address is then <code>http://127.0.0.1:8000</code>. ImaJev needs a Mac or a graphics
            card. Any server that answers like Jev (<code>POST /v1/systemone</code>) works.
          </p>
        </details>
        <div className="set-row set-row-actions">
          {needsServer ? (
            <span className="set-row-help">
              Add your server&apos;s address to use {mode === "local" ? "Local only" : "Hybrid"}.
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            aria-label="Save decision model"
            aria-busy={busy || checks.text === "checking"}
            disabled={!dirty || busy || needsServer || checks.text === "checking"}
            onClick={() => void saveModel()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        <div aria-live="polite">
          {modelMessage ? (
            <div className={modelMessage.tone === "ok" ? "set-row-success" : "set-row-error"}>
              {modelMessage.text}
            </div>
          ) : null}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Decision history">
        <SettingRow
          label="Keep what each decision saw"
          help="For 30 days, on this computer only, with passwords and keys removed. It lets you compare a decision server with Jev on your own decisions later. Turning it off deletes what is kept."
        >
          <Toggle
            label="Keep what each decision saw"
            checked={keep}
            disabled={busy}
            onChange={(next) => (next ? void saveHistory(true) : setConfirmForget(true))}
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
                    ["llm", "an engine standing in"],
                    ["heuristic", "the safe fallback"],
                  ]
                    .filter(([p]) => usage[p!])
                    .map(([p, name]) => `${usage[p!]} by ${name}`)
                    .join(", ")}.`
          }
        />
        <div aria-live="polite">
          {historyMessage ? (
            <div className={historyMessage.tone === "ok" ? "set-row-success" : "set-row-error"}>
              {historyMessage.text}
            </div>
          ) : null}
        </div>
      </SettingsGroup>
      {confirmForget ? (
        <ConfirmDialog
          title="Stop keeping what decisions saw?"
          confirmLabel="Turn off and delete"
          danger
          onConfirm={() => saveHistory(false)}
          onClose={() => setConfirmForget(false)}
        >
          <p>
            What decisions kept is deleted now, and new ones keep nothing. You won&apos;t be able to
            compare a decision server with Jev on decisions made until you turn it back on.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
