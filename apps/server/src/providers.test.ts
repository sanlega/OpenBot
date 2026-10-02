import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@openbot/contracts";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext } from "@openbot/core";
import { FakeComputerProvider } from "@openbot/computer-fake";
import {
  FakeDecisionService,
  FakeJevServer,
  KeyedDecisionService,
  RoutedDecisionService,
  UNCONFIGURED_MODEL,
} from "@openbot/decisions";
import { FakeEngineDriver } from "@openbot/engines-fake";
import { ClaudeDriver } from "@openbot/engines-claude";
import { CodexDriver } from "@openbot/engines-codex";
import { AcpDriver, customProfile, type AcpProfile } from "@openbot/engines-acp";
import { bootstrapProviders, type ProviderDetection } from "./providers.js";

const readyClaude: EngineStatus = {
  installed: true,
  version: "1.0.0",
  login: { ok: true, account: "user@example.com" },
  apiKey: { ok: false },
};

const readyCodex: EngineStatus = {
  installed: true,
  version: "1.0.0",
  login: { ok: true },
  apiKey: { ok: false },
};

const missingEngine: EngineStatus = {
  installed: false,
  login: { ok: false },
  apiKey: { ok: false },
};

function mockDetection(overrides: Partial<ProviderDetection> = {}): ProviderDetection {
  return {
    detectClaude: vi.fn(async () => readyClaude),
    detectCodex: vi.fn(async () => readyCodex),
    ...overrides,
  };
}

async function testContext() {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-providers-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
  const ctx = await createCoreContext({
    clock,
    config: {
      openbotHome,
      dbPath: ":memory:",
      logsThreadsDir: join(openbotHome, "logs", "threads"),
      workspaceDir: join(openbotHome, "workspace"),
      uploadsDir: join(openbotHome, "uploads"),
      trashDir: join(openbotHome, "trash"),
      vaultPath: join(openbotHome, "vault.bin"),
      vaultKeyPath: join(openbotHome, "vault.key"),
      deviceSecretPath: join(openbotHome, "device-secret"),
      modelsPath: join(openbotHome, "models.json"),
      screensDir: join(openbotHome, "screens"),
      routinesDir: join(openbotHome, "routines"),
      port: 3847,
    },
  });
  return ctx;
}

describe("bootstrapProviders", () => {
  it("selects real providers when prerequisites are present (mocked detection)", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_JEV;
    delete process.env.OPENBOT_FAKE_ENGINES;
    delete process.env.OPENBOT_FAKE_COMPUTER;
    delete process.env.OPENBOT_LOCAL_COMPUTER;
    delete process.env.JEV_API_KEY;

    const ctx = await testContext();
    await ctx.vault.set("typesafe.apiKey", "ts_live_key_1234567890");

    const detection = mockDetection();
    const result = await bootstrapProviders(ctx, detection);

    expect(result.decisionService).not.toBeInstanceOf(FakeDecisionService);
    expect(result.drivers.claude).toBeInstanceOf(ClaudeDriver);
    expect(result.drivers.codex).toBeInstanceOf(CodexDriver);
    expect(result.drivers.fake).toBeUndefined();
    expect(result.computerProvider?.id).toBe("docker");
    expect(result.computerImageManager?.getStatus()).toMatchObject({
      tag: "ghcr.io/sanlega/openbot-desktop:latest",
      state: "missing",
    });
    expect(result.availableEngines).toEqual(["claude", "codex"]);

    ctx.closeDb();
    process.env = prev;
  });

  it("records every Jev decision in the decisions table", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_JEV;
    delete process.env.JEV_API_KEY;
    const jev = new FakeJevServer({ apiKey: "ts_live_key_1234567890" });
    const { url } = await jev.listen();
    process.env.JEV_BASE_URL = url;
    try {
      const ctx = await testContext();
      await ctx.vault.set("typesafe.apiKey", "ts_live_key_1234567890");
      const { decisionService } = await bootstrapProviders(ctx, mockDetection());

      await decisionService.decide({
        purpose: "computer",
        state: "a page",
        questions: {
          action: {
            type: "choice",
            instructions: "Next?",
            criteria: { wait: "Wait", done: "Done" },
          },
        },
      });

      const rows = ctx.repos.decisions.list({ purpose: "computer" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider: "jev", purpose: "computer" });
      ctx.closeDb();
    } finally {
      await jev.close();
      process.env = prev;
    }
  });

  it("marks the TypeSafe setup step as not connected when the saved key is missing", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_JEV;
    delete process.env.JEV_API_KEY;

    const ctx = await testContext();
    ctx.repos.setupState.patch({ typesafe: { ok: true } });
    await bootstrapProviders(ctx, mockDetection());
    expect(ctx.repos.setupState.get().typesafe?.ok).toBe(false);

    ctx.repos.setupState.patch({ typesafe: { ok: true } });
    await ctx.vault.set("typesafe.apiKey", "ts_live_key_1234567890");
    await bootstrapProviders(ctx, mockDetection());
    expect(ctx.repos.setupState.get().typesafe?.ok).toBe(true);

    ctx.closeDb();
    process.env = prev;
  });

  it("never falls back to the fake Jev when no TypeSafe key is configured", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_JEV;
    delete process.env.JEV_API_KEY;

    const ctx = await testContext();
    const result = await bootstrapProviders(ctx, mockDetection());

    expect(result.decisionService).not.toBeInstanceOf(FakeDecisionService);
    // D-037: decisions go through the provider router; Jev (keyed) is behind it.
    expect(result.decisionService).toBeInstanceOf(RoutedDecisionService);
    const keyed = (result.decisionService as RoutedDecisionService)
      .jevService as KeyedDecisionService;
    expect(keyed).toBeInstanceOf(KeyedDecisionService);
    expect(await keyed.configured()).toBe(false);
    const decision = await keyed.decide({
      purpose: "trigger",
      state: { event: "new issue" },
      questions: { matches_trigger: { type: "noul", instructions: "Does it match?" } },
    });
    expect(decision.model).toBe(UNCONFIGURED_MODEL);
    expect(decision.answers.matches_trigger).toEqual({ type: "noul", noul: 0 });

    // A key saved later (e.g. by the setup wizard) is used without a restart.
    await ctx.vault.set("typesafe.apiKey", "ts_live_key_1234567890");
    expect(await keyed.configured()).toBe(true);

    ctx.closeDb();
    process.env = prev;
  });

  it("uses explicit fake flags for tests and CI", async () => {
    const prev = { ...process.env };
    process.env.OPENBOT_FAKE_JEV = "1";
    process.env.OPENBOT_FAKE_ENGINES = "1";
    process.env.OPENBOT_FAKE_COMPUTER = "1";

    const ctx = await testContext();
    const detection = mockDetection({
      detectClaude: vi.fn(async () => readyClaude),
      detectCodex: vi.fn(async () => readyCodex),
    });
    const result = await bootstrapProviders(ctx, detection);

    expect(result.decisionService).toBeInstanceOf(FakeDecisionService);
    expect(result.drivers.fake).toBeInstanceOf(FakeEngineDriver);
    expect(result.drivers.claude).toBeUndefined();
    expect(result.computerProvider).toBeInstanceOf(FakeComputerProvider);
    expect(result.computerImageManager).toBeUndefined();

    ctx.closeDb();
    process.env = prev;
  });

  it("skips engines when CLIs and keys are absent", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_ENGINES;

    const ctx = await testContext();
    const detection = mockDetection({
      detectClaude: vi.fn(async () => missingEngine),
      detectCodex: vi.fn(async () => missingEngine),
    });
    const result = await bootstrapProviders(ctx, detection);

    expect(result.drivers).toEqual({});
    expect(result.availableEngines).toEqual([]);
    expect(result.computerProvider?.id).toBe("docker");

    ctx.closeDb();
    process.env = prev;
  });

  it("picks up an engine signed in after start-up, keeping the wired ones (P1)", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_ENGINES;
    try {
      const ctx = await testContext();
      let codex = missingEngine;
      const detection = mockDetection({ detectCodex: vi.fn(async () => codex) });
      const result = await bootstrapProviders(ctx, detection);
      expect(result.availableEngines).toEqual(["claude"]);
      const claude = result.drivers.claude;

      codex = readyCodex;
      const available = await ctx.redetectEngines!();

      expect(available).toEqual(["claude", "codex"]);
      // The same map the runtime holds gets the new driver; the wired one is kept.
      expect(result.drivers.codex).toBeInstanceOf(CodexDriver);
      expect(result.drivers.claude).toBe(claude);
      expect(ctx.availableEngines).toEqual(["claude", "codex"]);
      expect(ctx.engineStatuses?.codex?.login.ok).toBe(true);

      // Checking again never rebuilds (or disposes) a wired driver: Codex's app-server is shared.
      const codexDriver = result.drivers.codex!;
      const dispose = vi.spyOn(codexDriver, "dispose");
      await ctx.redetectEngines!();
      expect(result.drivers.codex).toBe(codexDriver);
      expect(dispose).not.toHaveBeenCalled();

      // An engine signed out leaves the map, so routing no longer picks it.
      codex = missingEngine;
      expect(await ctx.redetectEngines!()).toEqual(["claude"]);
      expect(result.drivers.codex).toBeUndefined();
      ctx.closeDb();
    } finally {
      process.env = prev;
    }
  });

  it("an edited custom agent gets a new driver; an unchanged one is kept (P1)", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_ENGINES;
    process.env.OPENBOT_FAKE_JEV = "1";
    try {
      const ctx = await testContext();
      const result = await bootstrapProviders(
        ctx,
        mockDetection({ acpProfiles: () => (ctx.customEngines?.list() ?? []).map(customProfile) }),
      );
      // The command is this Node binary, so `--version` answers.
      await ctx.customEngines!.save([
        { slug: "goose", label: "Goose", command: process.execPath, args: ["acp"] },
      ]);
      await ctx.redetectEngines!();
      const first = result.drivers["acp-goose"];
      expect(first).toBeInstanceOf(AcpDriver);
      await ctx.redetectEngines!();
      expect(result.drivers["acp-goose"]).toBe(first);

      await ctx.customEngines!.save([
        { slug: "goose", label: "Goose", command: process.execPath, args: ["acp", "--fast"] },
      ]);
      await ctx.redetectEngines!();
      expect(result.drivers["acp-goose"]).not.toBe(first);

      await ctx.customEngines!.save([]);
      await ctx.redetectEngines!();
      expect(result.drivers["acp-goose"]).toBeUndefined();
      ctx.closeDb();
    } finally {
      process.env = prev;
    }
  });

  it("uses LocalProvider when the user opts in", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_COMPUTER;
    process.env.OPENBOT_LOCAL_COMPUTER = "1";

    const ctx = await testContext();
    const result = await bootstrapProviders(ctx, mockDetection());

    expect(result.computerProvider?.id).toBe("local");
    expect(result.computerImageManager).toBeUndefined();

    ctx.closeDb();
    process.env = prev;
  });

  it("wires every ACP engine that is installed and signed in, and describes all of them", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_ENGINES;
    process.env.OPENBOT_FAKE_JEV = "1";
    const ctx = await testContext();
    const profile = (id: string, installed: boolean, signedIn: boolean): AcpProfile => ({
      id,
      label: id.toUpperCase(),
      binaries: [installed ? process.execPath : join(ctx.config.openbotHome, "missing")],
      loginCommand: `${id} login`,
      async detect() {
        return { version: "1", login: { ok: signedIn } };
      },
      async listModels() {
        return [];
      },
      async launch() {
        return { args: [], env: {}, systemPrompt: "prompt" };
      },
    });
    const result = await bootstrapProviders(
      ctx,
      mockDetection({
        detectCodex: vi.fn(async () => missingEngine),
        acpProfiles: () => [
          profile("opencode", true, true),
          profile("cursor", true, false),
          profile("gemini", false, false),
        ],
      }),
    );
    expect(result.availableEngines).toEqual(["claude", "opencode"]);
    expect(result.drivers.opencode).toBeInstanceOf(AcpDriver);
    expect(result.drivers.cursor).toBeUndefined();
    expect(ctx.engineStatuses?.cursor).toMatchObject({ installed: true, login: { ok: false } });
    expect(ctx.engineStatuses?.gemini).toMatchObject({ installed: false });
    expect(ctx.engineDescriptors?.cursor).toMatchObject({
      label: "CURSOR",
      kind: "acp",
      loginCommand: "cursor login",
    });
    expect(ctx.engineDescriptors?.claude).toMatchObject({ kind: "native" });

    await ctx.customEngines?.save([
      { slug: "goose", label: "Goose", command: "goose", args: ["acp"] },
    ]);
    expect(ctx.customEngines?.list()).toEqual([
      { slug: "goose", label: "Goose", command: "goose", args: ["acp"] },
    ]);
    expect(customProfile(ctx.customEngines!.list()[0]!).id).toBe("acp-goose");

    ctx.closeDb();
    process.env = prev;
  });
});
