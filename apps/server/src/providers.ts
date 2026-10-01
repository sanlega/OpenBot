import { join } from "node:path";
import type {
  ComputerImageManager,
  ComputerProvider,
  DecisionService,
  EngineDescriptor,
  EngineDriver,
  EngineId,
  EngineStatus,
} from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { FakeComputerProvider } from "@openbot/computer-fake";
import {
  createDockerProvider,
  createImageManager,
  DEFAULT_IMAGE,
  desktopImageFor,
  findLocalDockerfile,
} from "@openbot/computer-docker";
import { SERVER_VERSION } from "./index.js";
import { LocalProvider } from "@openbot/computer-local";
import {
  createDecisionService,
  DecisionLog,
  FakeDecisionService,
  JevClient,
  KeyedDecisionService,
} from "@openbot/decisions";
import {
  AcpDriver,
  builtinAcpProfiles,
  customProfiles,
  readEnginePrefs,
  writeEnginePrefs,
  type AcpProfile,
} from "@openbot/engines-acp";
import { ClaudeDriver, detectClaude } from "@openbot/engines-claude";
import { CodexDriver, detectCodex } from "@openbot/engines-codex";
import { validateAnthropicKey, validateOpenAiKey } from "@openbot/engines-common";
import { FakeEngineDriver } from "@openbot/engines-fake";

export const VAULT_KEYS = {
  typesafe: "typesafe.apiKey",
  anthropic: "anthropic.apiKey",
  openai: "openai.apiKey",
} as const;

export interface ProviderDetection {
  detectClaude: typeof detectClaude;
  detectCodex: typeof detectCodex;
  /** ACP engines to offer (D-031): production passes the built-in ones plus the owner's custom ones; none when omitted. */
  acpProfiles?: (openbotHome: string) => AcpProfile[];
}

export interface BootstrapProvidersResult {
  decisionService: DecisionService;
  drivers: Partial<Record<EngineId, EngineDriver>>;
  computerProvider?: ComputerProvider;
  computerImageManager?: ComputerImageManager;
  engineStatuses: Record<string, EngineStatus>;
  engineDescriptors: Record<string, EngineDescriptor>;
  availableEngines: EngineId[];
}

const NATIVE_DESCRIPTORS: Record<string, EngineDescriptor> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    kind: "native",
    loginCommand: "claude auth login",
    installUrl: "https://claude.com/product/claude-code",
    summary:
      "Anthropic's Claude Code agent: strong at coding, writing and careful multi-step work.",
    capabilities: { resume: true, steer: true },
  },
  codex: {
    id: "codex",
    label: "Codex",
    kind: "native",
    loginCommand: "codex login",
    installUrl: "https://developers.openai.com/codex/cli",
    summary: "OpenAI's Codex agent: strong at coding and long autonomous tasks.",
    capabilities: { resume: true, steer: true },
  },
};

function defaultAcpProfiles(openbotHome: string): AcpProfile[] {
  return [...builtinAcpProfiles(), ...customProfiles(readEnginePrefs(openbotHome))];
}

const defaultDetection: ProviderDetection = {
  detectClaude,
  detectCodex,
  acpProfiles: defaultAcpProfiles,
};

function fakeFlag(name: string): boolean {
  return process.env[name] === "1";
}

function engineReady(status: EngineStatus): boolean {
  return status.login.ok || status.apiKey.ok;
}

/** Resolves production providers from config, vault, and environment detection. */
export async function bootstrapProviders(
  ctx: CoreContext,
  detection: ProviderDetection = defaultDetection,
): Promise<BootstrapProvidersResult> {
  const decisionService = resolveDecisionService(ctx);
  const { drivers, engineStatuses, engineDescriptors, availableEngines } =
    await resolveEngineDrivers(ctx, detection);
  const imageTag = desktopImageTag();
  const computerImageManager =
    fakeFlag("OPENBOT_FAKE_COMPUTER") || fakeFlag("OPENBOT_LOCAL_COMPUTER")
      ? undefined
      : resolveComputerImageManager(ctx, imageTag);
  const computerProvider = resolveComputerProvider(ctx, imageTag, computerImageManager);
  // An updated OpenBot gets its matching desktop image in the background.
  void computerImageManager?.checkForUpdate().catch(() => undefined);

  registerSetupValidators(ctx, decisionService, detection);
  await reconcileTypesafeSetup(ctx);

  ctx.availableEngines = availableEngines;
  ctx.engineStatuses = engineStatuses;
  ctx.engineDescriptors = engineDescriptors;
  // P1: engines installed or signed in while OpenBot runs are picked up without a restart.
  ctx.redetectEngines = () => redetectEngines(ctx, drivers, detection);
  const home = ctx.config.openbotHome;
  ctx.customEngines = {
    list: () => readEnginePrefs(home).custom,
    save: (custom) => writeEnginePrefs(home, { ...readEnginePrefs(home), custom }),
  };

  return {
    decisionService,
    drivers,
    computerProvider,
    computerImageManager,
    engineStatuses,
    engineDescriptors,
    availableEngines,
  };
}

/**
 * Jev is required (plan U1), so production never falls back to the fake: with
 * no key yet, decisions degrade conservatively and the key is re-read from the
 * vault on each call, so the one saved by the setup wizard applies immediately.
 */
function resolveDecisionService(ctx: CoreContext): DecisionService {
  if (fakeFlag("OPENBOT_FAKE_JEV")) return new FakeDecisionService();

  // JEV_BASE_URL points at another Jev-compatible endpoint (a proxy, or a fake in E2E).
  const baseUrl = process.env.JEV_BASE_URL || undefined;
  return new KeyedDecisionService({
    getApiKey: async () => process.env.JEV_API_KEY || (await ctx.vault.get(VAULT_KEYS.typesafe)),
    // Every decision lands in the `decisions` table (Audit, and diagnosing a task later).
    create: (apiKey) =>
      createDecisionService({ apiKey, baseUrl, decisionLog: new DecisionLog(ctx.repos.decisions) }),
    probeKey: (apiKey) => new JevClient({ apiKey, baseUrl }).validateKey(),
  });
}

/**
 * P1: detects the engines again and plugs newly ready ones into the same `drivers` map the
 * runtime and the turn builder hold (they see them at once). A driver that is already wired is
 * kept (its sessions and app-server stay); one that is no longer ready simply stops being offered.
 */
export async function redetectEngines(
  ctx: CoreContext,
  drivers: Partial<Record<EngineId, EngineDriver>>,
  detection: ProviderDetection = defaultDetection,
): Promise<EngineId[]> {
  const fresh = await resolveEngineDrivers(ctx, detection);
  for (const [id, driver] of Object.entries(fresh.drivers) as Array<[EngineId, EngineDriver]>) {
    if (drivers[id]) {
      if (drivers[id] !== driver) await driver.dispose().catch(() => undefined);
    } else {
      drivers[id] = driver;
    }
  }
  ctx.availableEngines = fresh.availableEngines;
  ctx.engineStatuses = fresh.engineStatuses;
  ctx.engineDescriptors = fresh.engineDescriptors;
  return fresh.availableEngines;
}

async function resolveEngineDrivers(
  ctx: CoreContext,
  detection: ProviderDetection,
): Promise<{
  drivers: Partial<Record<EngineId, EngineDriver>>;
  engineStatuses: Record<string, EngineStatus>;
  engineDescriptors: Record<string, EngineDescriptor>;
  availableEngines: EngineId[];
}> {
  const enginesDir = join(ctx.config.openbotHome, "engines");
  const acpDrivers = (detection.acpProfiles?.(ctx.config.openbotHome) ?? []).map(
    (profile) => new AcpDriver(profile, { enginesDir }),
  );
  // Every CLI is probed at once: a slow or missing one must not hold up the rest.
  const [claudeStatus, codexStatus, ...acpStatuses] = await Promise.all([
    detection.detectClaude(),
    detection.detectCodex(),
    ...acpDrivers.map((d) => d.detect()),
  ]);
  const engineStatuses: Record<string, EngineStatus> = {
    claude: claudeStatus!,
    codex: codexStatus!,
  };
  const engineDescriptors: Record<string, EngineDescriptor> = { ...NATIVE_DESCRIPTORS };
  acpDrivers.forEach((driver, i) => {
    engineStatuses[driver.id] = acpStatuses[i]!;
    engineDescriptors[driver.id] = driver.describe();
  });

  if (fakeFlag("OPENBOT_FAKE_ENGINES")) {
    return {
      drivers: { fake: new FakeEngineDriver() },
      engineStatuses,
      engineDescriptors,
      availableEngines: ["fake"],
    };
  }

  const drivers: Partial<Record<EngineId, EngineDriver>> = {};
  const availableEngines: EngineId[] = [];

  if (engineReady(claudeStatus!)) {
    drivers.claude = new ClaudeDriver();
    availableEngines.push("claude");
  }
  if (engineReady(codexStatus!)) {
    drivers.codex = new CodexDriver();
    availableEngines.push("codex");
  }
  acpDrivers.forEach((driver, i) => {
    const status = acpStatuses[i]!;
    // ACP CLIs sign in themselves; an installed one that says it is signed in is ready.
    if (status.installed && status.login.ok) {
      drivers[driver.id] = driver;
      availableEngines.push(driver.id);
    }
  });

  return { drivers, engineStatuses, engineDescriptors, availableEngines };
}

/**
 * The desktop image for this app: its own version's (`:v<version>`) in an installed app, so the
 * daemon inside always matches; `:latest` in a dev checkout (built locally from
 * images/desktop); `OPENBOT_DESKTOP_IMAGE` overrides both.
 */
function desktopImageTag(): string {
  const override = process.env.OPENBOT_DESKTOP_IMAGE?.trim();
  if (override) return override;
  return findLocalDockerfile() ? DEFAULT_IMAGE : desktopImageFor(SERVER_VERSION);
}

function resolveComputerProvider(
  ctx: CoreContext,
  image: string,
  imageManager?: ComputerImageManager & { ensure?: () => Promise<void> },
): ComputerProvider {
  if (fakeFlag("OPENBOT_FAKE_COMPUTER")) return new FakeComputerProvider();

  if (fakeFlag("OPENBOT_LOCAL_COMPUTER")) return new LocalProvider();

  // Keep the provider wired even while Docker Desktop is starting. Its start
  // operation checks the daemon again, so opening Docker needs no app restart.
  // D-032: the virtual machine sees the bots' workspace at /workspace (same files everywhere).
  // A second desktop next to the installed app's (live tests on a copied home): its own
  // container, ports and browser volume.
  const port = (name: string) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };
  return createDockerProvider({
    workspaceMount: ctx.config.workspaceDir,
    image,
    containerName: process.env.OPENBOT_DESKTOP_CONTAINER?.trim() || undefined,
    controlPort: port("OPENBOT_DESKTOP_CONTROL_PORT"),
    liveViewPort: port("OPENBOT_DESKTOP_VIEW_PORT"),
    browserVolume: process.env.OPENBOT_DESKTOP_VOLUME?.trim() || undefined,
    ensureImage: imageManager?.ensure ? () => imageManager.ensure!() : undefined,
  });
}

/** Gets/resets the docker provider's desktop image (D-020); every status change is published as `computer.image_status`. */
function resolveComputerImageManager(ctx: CoreContext, tag: string) {
  return createImageManager({
    tag,
    localDockerfile: findLocalDockerfile(),
    onStatus: (status) => {
      // The image is checked in the background at start-up; if the harness has shut down by
      // the time it answers, there is no one to tell (and no database to record it in).
      void ctx.eventBus
        .publish({ type: "computer.image_status", payload: { ...status } })
        .catch(() => undefined);
    },
  });
}

/**
 * Setup remembers "TypeSafe key: ok" even if the key is gone from the vault (or
 * was never saved). Then Jev silently falls back on every decision, so report
 * it as not connected and let Settings ask for the key again.
 */
async function reconcileTypesafeSetup(ctx: CoreContext): Promise<void> {
  if (fakeFlag("OPENBOT_FAKE_JEV") || process.env.JEV_API_KEY) return;
  if (ctx.repos.setupState.get().typesafe?.ok !== true) return;
  if (await ctx.vault.get(VAULT_KEYS.typesafe)) return;
  ctx.repos.setupState.patch({ typesafe: { ok: false } });
}

function registerSetupValidators(
  ctx: CoreContext,
  decisionService: DecisionService,
  detection: ProviderDetection,
): void {
  ctx.validators.typesafe = async (value) => {
    const result = await decisionService.validateKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.typesafe, value);
    return result.ok ? { ok: true } : { ok: false, reason: "invalid Typesafe API key" };
  };

  ctx.validators.anthropic = async (value) => {
    const result = await validateAnthropicKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.anthropic, value);
    return result;
  };

  ctx.validators.openai = async (value) => {
    const result = await validateOpenAiKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.openai, value);
    return result;
  };

  ctx.validators.claude_login = async (value) => {
    if (value?.trim()) {
      const keyResult = await validateAnthropicKey(value);
      if (keyResult.ok) {
        await ctx.vault.set(VAULT_KEYS.anthropic, value);
        return { ok: true };
      }
    }
    const status = await detection.detectClaude();
    if (status.login.ok) return { ok: true };
    if (status.apiKey.ok) return { ok: true };
    return { ok: false, reason: "Claude CLI not logged in and no API key configured" };
  };

  ctx.validators.codex_login = async (value) => {
    if (value?.trim()) {
      const keyResult = await validateOpenAiKey(value);
      if (keyResult.ok) {
        await ctx.vault.set(VAULT_KEYS.openai, value);
        return { ok: true };
      }
    }
    const status = await detection.detectCodex();
    if (status.login.ok) return { ok: true };
    if (status.apiKey.ok) return { ok: true };
    return { ok: false, reason: "Codex CLI not logged in and no API key configured" };
  };
}
