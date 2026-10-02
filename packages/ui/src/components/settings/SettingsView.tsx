import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Settings, SetupState } from "@openbot/contracts";
import { Check, Eye, EyeOff, Laptop, Moon, Sun } from "lucide-react";
import type { EnginesResponse, SettingsPatch } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { getStoredTheme, setTheme, type ThemePreference } from "../../state/theme.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { ComputerHealthCard } from "./ComputerHealthCard.js";
import { ComputerImageCard } from "./ComputerImageCard.js";
import { DataSettings } from "./DataSettings.js";
import { DecisionProviderCard } from "./DecisionProviderCard.js";
import { EnginesSettings } from "./EnginesSettings.js";
import { SavedLogins } from "./SavedLogins.js";
import { SpeedCard } from "./SpeedCard.js";
import { SpendingToday } from "./SpendingToday.js";
import { BUDGET_META, CAP_META, HOURS, hourLabel, metaFor } from "./settings-meta.js";
import {
  NumberField,
  SettingRow,
  SettingsGroup,
  SettingsSection,
  StatusPill,
  Toggle,
} from "./SettingsPrimitives.js";
import { friendlyError } from "../../api/errors.js";

type Engine = EnginesResponse["engines"][number];
type Editable = Pick<Settings, "caps" | "budgets" | "quietHours" | "botDefaults">;

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "engines", label: "Engines" },
  { id: "jev", label: "Jev" },
  { id: "autonomy", label: "Autonomy" },
  { id: "new-bots", label: "New bots" },
  { id: "computer", label: "Computer" },
  { id: "notifications", label: "Notifications" },
  { id: "speed", label: "Speed" },
  { id: "spending", label: "Spending" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
] as const;

const THEMES: Array<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: "system", label: "System", icon: <Laptop size={14} /> },
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
];

const DEFAULT_QUIET = { enabled: false, start: "22:00", end: "08:00" };

type BotDefaultsValue = NonNullable<Settings["botDefaults"]>;

/** M1: engine, permissions and computer for bots created without choosing. */
function NewBotDefaults({
  value,
  engines,
  onChange,
}: {
  value: BotDefaultsValue;
  engines: Engine[];
  onChange: (next: BotDefaultsValue) => void;
}) {
  const routing =
    value.routing?.mode === "pinned" && value.routing.engine ? value.routing.engine : "auto";
  const usable = engines.filter((e) => e.available ?? (e.installed && e.login.ok));
  return (
    <SettingsGroup>
      <SettingRow
        label="Engine"
        help="Auto lets Jev pick the engine and model for each message."
        htmlFor="default-engine"
      >
        <select
          id="default-engine"
          className="set-select"
          value={routing}
          onChange={(e) =>
            onChange({
              ...value,
              routing:
                e.target.value === "auto"
                  ? { mode: "auto" }
                  : { mode: "pinned", engine: e.target.value },
            })
          }
        >
          <option value="auto">Auto (recommended)</option>
          {usable.map((e) => (
            <option key={e.id} value={e.id}>
              {e.descriptor?.label ?? e.id}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Permissions"
        help={
          (value.permissionPreset ?? "full") === "full"
            ? "Recommended. Works without asking, except to spend money or delete things."
            : (value.permissionPreset ?? "full") === "workspace_write"
              ? "Changes files in its workspace; asks before anything else."
              : "Can read, but asks you before changing anything."
        }
        htmlFor="default-permissions"
      >
        <select
          id="default-permissions"
          className="set-select"
          value={value.permissionPreset ?? "full"}
          onChange={(e) =>
            onChange({
              ...value,
              permissionPreset: e.target.value as BotDefaultsValue["permissionPreset"],
            })
          }
        >
          <option value="full">Full</option>
          <option value="workspace_write">Workspace only</option>
          <option value="read_only">Read only</option>
        </select>
      </SettingRow>
      <SettingRow
        label="Computer"
        help={
          (value.computer ?? "docker") === "docker"
            ? "Recommended. Works inside the virtual machine, never on this computer."
            : (value.computer ?? "docker") === "docker+local"
              ? "The virtual machine, and also this computer's shell, files and browser."
              : "No computer: chat and connectors only."
        }
        htmlFor="default-computer"
      >
        <select
          id="default-computer"
          className="set-select"
          value={value.computer ?? "docker"}
          onChange={(e) =>
            onChange({ ...value, computer: e.target.value as BotDefaultsValue["computer"] })
          }
        >
          <option value="docker">Virtual machine</option>
          <option value="docker+local">VM + this computer</option>
          <option value="none">None</option>
        </select>
      </SettingRow>
    </SettingsGroup>
  );
}

function editableOf(s: Settings): Editable {
  return {
    caps: s.caps,
    budgets: s.budgets,
    quietHours: s.quietHours,
    botDefaults: s.botDefaults ?? {},
  };
}

function sameEditable(a: Editable, b: Editable): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsView() {
  const { transport } = useOpenBot();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      transport.get<{ settings: Settings }>("/api/settings"),
      transport.get<{ setup: SetupState }>("/api/setup"),
      transport.get<EnginesResponse>("/api/engines").catch(() => ({ engines: [] })),
    ])
      .then(([s, setupRes, eng]) => {
        if (cancelled) return;
        setSaved(s.settings);
        setDraft(editableOf(s.settings));
        setSetup(setupRes.setup);
        setEngines(eng.engines);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    transport
      .get<{ version?: string }>("/api/harness/status")
      .then((r) => !cancelled && setVersion(r.version ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [transport, loadAttempt]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Highlight the section in view in the side nav.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !saved || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = root.querySelector(`#${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [saved]);

  const dirty = useMemo(
    () => (saved && draft ? !sameEditable(editableOf(saved), draft) : false),
    [saved, draft],
  );

  if (!saved || !draft || !setup) {
    return (
      <div className="screen" data-testid="settings-view">
        <ScreenHeader title="Settings" />
        <div className="empty-state">
          {loadError ? (
            <>
              <p>Couldn’t load settings. Check the connection and try again.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLoadAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </>
          ) : (
            "Loading settings…"
          )}
        </div>
      </div>
    );
  }

  const quiet = draft.quietHours ?? DEFAULT_QUIET;

  const setCap = (key: string, value: number) =>
    setDraft({ ...draft, caps: { ...draft.caps, [key]: value } });
  const setBudget = (key: string, value: number) =>
    setDraft({ ...draft, budgets: { ...draft.budgets, [key]: value } });
  const setQuiet = (patch: Partial<typeof quiet>) =>
    setDraft({ ...draft, quietHours: { ...quiet, ...patch } });

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: SettingsPatch = {
        caps: draft.caps,
        budgets: draft.budgets,
        ...(draft.quietHours ? { quietHours: draft.quietHours } : {}),
        botDefaults: draft.botDefaults ?? {},
      };
      const res = await transport.patch<{ settings: Settings }>("/api/settings", patch);
      setSaved(res.settings);
      setDraft(editableOf(res.settings));
      setToast("Settings saved");
    } catch (err) {
      setSaveError(friendlyError(err, "Couldn't save settings."));
    } finally {
      setSaving(false);
    }
  };

  const capKeys = Object.keys(draft.caps).sort(
    (a, b) => metaFor(CAP_META, a).order - metaFor(CAP_META, b).order,
  );
  const spawnCaps = capKeys.filter((k) => metaFor(CAP_META, k).group === "spawn");
  const messageCaps = capKeys.filter((k) => metaFor(CAP_META, k).group === "messages");
  const budgetKeys = Object.keys(draft.budgets).sort(
    (a, b) => metaFor(BUDGET_META, a).order - metaFor(BUDGET_META, b).order,
  );

  const jump = (id: string) => {
    setActive(id);
    bodyRef.current
      ?.querySelector(`#${id}`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="screen" data-testid="settings-view">
      <ScreenHeader title="Settings" subtitle="Preferences for this OpenBot and its bots" />
      <div className="screen-body" ref={bodyRef}>
        <div className="set-layout">
          <nav className="set-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="set-nav-item"
                aria-current={active === s.id ? "true" : undefined}
                onClick={() => jump(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="set-content">
            <SettingsSection id="appearance" title="Appearance">
              <SettingsGroup>
                <SettingRow label="Theme" help="Follow your system, or pick one for this device.">
                  <ThemePicker />
                </SettingRow>
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="engines"
              title="Engines"
              description="The agents your bots run on: Claude Code, Codex, Cursor, OpenCode (with local models) and more. OpenBot uses your own logins and keys."
            >
              {setup ? (
                <EnginesSettings
                  engines={engines}
                  setup={setup}
                  onRefresh={async () => {
                    const eng = await transport
                      .get<EnginesResponse>("/api/engines")
                      .catch(() => undefined);
                    if (eng) setEngines(eng.engines);
                  }}
                />
              ) : null}
            </SettingsSection>

            <SettingsSection
              id="jev"
              title="Jev"
              description="Jev (by TypeSafe) makes the fast yes/no calls behind every new bot, notification, and risky step."
            >
              <JevKeyCard setup={setup} onSetup={setSetup} />
              {saved ? <DecisionProviderCard settings={saved} onSaved={setSaved} /> : null}
              <SettingsGroup title="Decision budgets">
                {budgetKeys.map((key) => {
                  const meta = metaFor(BUDGET_META, key);
                  return (
                    <SettingRow
                      key={key}
                      label={meta.label}
                      help={meta.help}
                      htmlFor={`budget-${key}`}
                    >
                      <NumberField
                        id={`budget-${key}`}
                        value={draft.budgets[key] ?? 0}
                        unit={meta.unit}
                        onChange={(v) => setBudget(key, v)}
                      />
                    </SettingRow>
                  );
                })}
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="autonomy"
              title="Autonomy"
              description="Hard limits on what bots can do on their own. Bots never see these numbers."
            >
              {spawnCaps.length ? (
                <SettingsGroup title="Creating bots">
                  {spawnCaps.map((key) => (
                    <CapRow key={key} capKey={key} value={draft.caps[key] ?? 0} onChange={setCap} />
                  ))}
                </SettingsGroup>
              ) : null}
              {messageCaps.length ? (
                <SettingsGroup title="Messages to you">
                  {messageCaps.map((key) => (
                    <CapRow key={key} capKey={key} value={draft.caps[key] ?? 0} onChange={setCap} />
                  ))}
                </SettingsGroup>
              ) : null}
            </SettingsSection>

            <SettingsSection
              id="new-bots"
              title="New bots"
              description="What a bot starts with when you or the Chief of Staff create one without choosing. Existing bots keep their own settings."
            >
              <NewBotDefaults
                value={draft.botDefaults ?? {}}
                engines={engines}
                onChange={(botDefaults) => setDraft({ ...draft, botDefaults })}
              />
            </SettingsSection>

            <SettingsSection
              id="computer"
              title="Computer"
              description="The shared virtual desktop bots use for Computer tasks."
            >
              <ComputerHealthCard />
              <ComputerImageCard />
              <SavedLogins />
            </SettingsSection>

            <SettingsSection id="notifications" title="Notifications">
              <SettingsGroup>
                <SettingRow
                  label="Quiet hours"
                  help="Only time-sensitive messages notify you. Everything else waits until quiet hours end."
                >
                  <Toggle
                    label="Quiet hours"
                    checked={quiet.enabled}
                    onChange={(enabled) => setQuiet({ enabled })}
                  />
                </SettingRow>
                {quiet.enabled ? (
                  <SettingRow label="Schedule" help="Uses this computer's time zone.">
                    <div className="set-hours">
                      <select
                        className="set-select"
                        aria-label="Quiet hours start"
                        value={quiet.start}
                        onChange={(e) => setQuiet({ start: e.target.value })}
                      >
                        {withValue(HOURS, quiet.start).map((h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </select>
                      <span className="set-hours-sep">to</span>
                      <select
                        className="set-select"
                        aria-label="Quiet hours end"
                        value={quiet.end}
                        onChange={(e) => setQuiet({ end: e.target.value })}
                      >
                        {withValue(HOURS, quiet.end).map((h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </SettingRow>
                ) : null}
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="speed"
              title="Speed"
              description="How long each bot takes to start answering (median of its latest turns). Slow first words usually mean the engine is starting up or busy."
            >
              <SpeedCard />
            </SettingsSection>

            <SettingsSection id="spending" title="Spending">
              <SpendingToday />
              <SettingsGroup title="Limits">
                <SettingRow
                  label="Daily limit per bot"
                  help="Set on each bot's profile. When a bot hits its limit it pauses and tells you once."
                />
                <SettingRow
                  label="Routine runs"
                  help="Each routine has its own per-run and daily limits, set when you create it."
                />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="data"
              title="Data"
              description="What OpenBot keeps on this computer."
            >
              <DataSettings />
            </SettingsSection>

            <SettingsSection id="about" title="About">
              <SettingsGroup>
                <SettingRow label="OpenBot" help="Open harness for a small team of AI bots.">
                  <span className="set-value">{version ? `Version ${version}` : "Version —"}</span>
                </SettingRow>
                <SettingRow label="Connected to" help="The OpenBot harness this window talks to.">
                  <span className="set-value set-mono">{hostOf(transport.baseUrl)}</span>
                </SettingRow>
              </SettingsGroup>
            </SettingsSection>
          </div>
        </div>

        {dirty ? (
          <div className="set-savebar" role="region" aria-label="Unsaved changes">
            <span className="set-savebar-text">
              {saveError ? (
                <span className="set-error">{saveError}</span>
              ) : (
                "You have unsaved changes"
              )}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={saving}
              onClick={() => {
                setDraft(editableOf(saved));
                setSaveError(null);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        ) : null}
      </div>
      {toast ? (
        <div className="set-toast" role="status">
          <Check size={14} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function withValue(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value].sort();
}

function hostOf(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).host || "This computer";
  } catch {
    return url || "This computer";
  }
}

function CapRow({
  capKey,
  value,
  onChange,
}: {
  capKey: string;
  value: number;
  onChange: (key: string, value: number) => void;
}) {
  const meta = metaFor(CAP_META, capKey);
  return (
    <SettingRow label={meta.label} help={meta.help} htmlFor={`cap-${capKey}`}>
      <NumberField
        id={`cap-${capKey}`}
        value={value}
        unit={meta.unit}
        onChange={(v) => onChange(capKey, v)}
      />
    </SettingRow>
  );
}

function ThemePicker() {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme);
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={theme === t.value}
          className="segmented-option set-theme-option"
          onClick={() => {
            setTheme(t.value);
            setThemeState(t.value);
          }}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function JevKeyCard({
  setup,
  onSetup,
}: {
  setup: SetupState;
  onSetup: (setup: SetupState) => void;
}) {
  const { transport } = useOpenBot();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const connected = setup.typesafe?.ok === true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await transport.post<{
        result: { ok: boolean; reason?: string };
        setup?: SetupState;
      }>("/api/setup/validate", { kind: "typesafe", value: key.trim() });
      if (res.setup) onSetup(res.setup);
      if (res.result.ok) {
        setKey("");
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2200);
      } else {
        setError(res.result.reason ?? "That key didn't work. Check it and try again.");
      }
    } catch (err) {
      setError(friendlyError(err, "Couldn't check the key."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup>
      <SettingRow
        label="Jev (TypeSafe) API key"
        help={
          connected
            ? "Stored in your local vault. Paste a new key to replace it."
            : "Add a key so bots can make decisions."
        }
      >
        {connected ? (
          <StatusPill tone="success">Connected</StatusPill>
        ) : (
          <StatusPill tone="warning">Missing</StatusPill>
        )}
      </SettingRow>
      <form
        className="set-row set-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim().length > 0 && !busy) void submit();
        }}
      >
        <div className="set-secret">
          <input
            type={show ? "text" : "password"}
            placeholder={connected ? "••••••••••••  (saved)" : "Paste your Jev API key"}
            aria-label="Jev (TypeSafe) API key"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
            }}
          />
          <button
            type="button"
            className="set-secret-toggle"
            aria-label={show ? "Hide key" : "Show key"}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={busy || key.trim().length === 0}
        >
          {busy ? "Checking…" : justSaved ? "Saved" : connected ? "Replace key" : "Save key"}
        </button>
      </form>
      {error ? <div className="set-row-error">{error}</div> : null}
    </SettingsGroup>
  );
}
