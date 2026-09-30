# Plan: More engines — ACP CLIs (Cursor, OpenCode, Gemini, Grok…) and local models

- **Date**: 2026-09-30 · **Author**: Claude · **Status**: done (2026-09-30), see D-031
- **Original request**: "connect new providers: local models and other CLI models like
  Cursor; research T3 Code, which is open source and has many providers."
- **Research**: `.ai/resources/2026-09-30-t3code-providers-research.md`

## Goal

A Bot can run on Cursor, OpenCode, Gemini CLI, Grok Build or any other agent CLI that
speaks the Agent Client Protocol, and on a local model (Ollama / LM Studio) with no cloud
account, keeping OpenBot's MCP tools, approvals, delegation and Jev routing.

## Scope

**Includes**
- Open the engine set: `EngineId` stops being a closed `claude|codex|fake` enum.
- One generic ACP driver package `@openbot/engines-acp` (official `@agentclientprotocol/sdk`)
  plus built-in profiles: `cursor`, `opencode`, `gemini`, `grok`, and a user-defined
  "custom ACP command".
- Local models through the `opencode` profile: OpenBot writes a private OpenCode config
  with an OpenAI-compatible provider pointing at Ollama (`:11434/v1`) or LM Studio
  (`:1234/v1`), and lists their installed models.
- Detection, model list, setup wizard/Settings cards, bot Profile engine picker, Jev route
  question aware of the new engines, doctor output.

**Out of scope**
- Our own agent loop over a raw OpenAI-compatible API (see "Alternatives").
- Antigravity (managed installer + Google sign-in flow; revisit later).
- Several accounts per engine (T3's "instances"); one config per engine for now.
- Installing/updating CLIs from the app (we only detect and link to install docs).
- Running engines inside the VM (backlog #8 stays separate).

## Acceptance criteria

1. Given `opencode` installed and Ollama running with `qwen3:8b`, when the owner picks
   engine "OpenCode" + model `ollama/qwen3:8b` for a Bot and sends a message, then the
   reply streams into the chat, tool calls show in Activity, and nothing leaves the machine
   (no cloud provider key configured).
2. Given `cursor-agent` installed and logged in, when a Bot on engine "Cursor" gets a task,
   then it runs through ACP and can call OpenBot MCP tools (`message_user`, `list_bots`…).
3. Given an ACP agent asks `session/request_permission` under preset `workspace_write`,
   then an OpenBot approval card appears; Allow/Deny replies with the agent's native
   option id; under `full` no card appears (same rule as D-030/D-028).
4. Given a Bot on an ACP engine, when the next turn starts, then the session resumes
   (`session/load` when the agent advertises `loadSession`) and remembers the previous turn.
5. Given the owner stops a turn, then `session/cancel` is sent and the turn ends
   `interrupted` within 15 s (process killed if not).
6. Given a CLI that is not installed or not logged in, then Setup/Settings shows it as
   such with its login command, and no session, MCP server or browser login is started by
   the check.
7. Given the owner adds a custom ACP command (name, command, args), then it appears as an
   engine and passes the same conformance suite as the built-ins (fixture-backed in CI).
8. Existing Claude/Codex Bots, stored sessions and setup state keep working after the
   upgrade (migration test on a copy of a real `~/.openbot`, per LESSONS).
9. Jev auto routing only offers engines that are ready, and is told which are local/slow
   so it avoids them for heavy tasks unless the Bot pins them.

## Design

- **Contracts** (`packages/contracts`, coordinator-reviewed):
  - `EngineId` becomes `z.string().regex(/^[a-z][a-z0-9-]{1,31}(:[a-z0-9-]{1,32})?$/)`
    with `BUILTIN_ENGINES = ["claude","codex","cursor","opencode","gemini","grok","fake"]`;
    custom engines are `acp:<slug>`.
  - New `EngineDescriptor { id, label, kind: "native"|"acp", local: boolean,
    loginCommand?, installUrl?, capabilities: { resume, steer, images } }` exposed by each
    driver (`EngineDriver.describe()`), used by UI, doctor and the route question.
  - `EngineStatus` gains optional `endpoint?: { ok, url }` for local model servers.
- **Store**: migration 0004 adds `engine_setup` (engine id → JSON status/mode) and
  `custom_engines` (slug, label, command, args JSON, env keys); the old `claude`/`codex`
  columns stay and are read as fallback. `engines/providers.ts` status typing becomes a
  `Record<string, EngineStatus>`.
- **`@openbot/engines-acp`** (`packages/engines/acp/`):
  - `AcpDriver(profile)` implements `EngineDriver`. One child process per Bot session
    (ACP sessions are per-process state for most agents; simpler than sharing).
  - `initialize` (clientCapabilities: **no** `fs`/`terminal` — the agent uses its own
    tools, like Claude/Codex today) → `session/new {cwd, mcpServers}` or `session/load`.
    MCP: OpenBot's stdio shim spec maps 1:1 to ACP stdio `McpServer {name, command, args,
    env[]}`.
  - `session/prompt` → `session/update` mapping: `agent_message_chunk`→`text_delta`,
    `tool_call`/`tool_call_update`→`tool_started`/`tool_completed`, `usage_update`/prompt
    response usage→`usage`, stop reason→`TurnResult`. `plan`/`thought` chunks ignored
    for now.
  - `session/request_permission` → `hooks.requestApproval`; map to the native
    `allow_once`/`reject_once` option ids (never `allow_always`, so a grant cannot widen).
  - `steer`: ACP has no mid-turn input → queue text and send it as the next prompt when the
    current one ends (capability `steer: false` so the UI/runtime knows).
  - `interrupt`: `session/cancel`, then SIGTERM after 15 s.
  - Model: `session/set_model` or the `model` config option when advertised; else a
    profile-specific CLI flag/env.
  - Profile = `{ id, label, command, args(permission), authMethodId?, env(...), detect() ,
    listModels(), transformText? }`. Built-ins: cursor (`cursor-agent [--force] acp`,
    Cursor transport-failure text → error, as T3), opencode (`opencode acp`), gemini
    (`gemini --experimental-acp`), grok (`grok agent [--always-approve] stdio`).
    Exact flags are verified in T1; do not trust this table until then.
- **Local models** (opencode profile): per-Bot private config dir (set
  `OPENCODE_CONFIG_DIR`/XDG vars so the owner's global OpenCode config, plugins and MCP
  servers never reach Bots — same lesson as Codex D-027) and `OPENCODE_CONFIG_CONTENT`
  declaring `ollama` / `lmstudio` providers (`@ai-sdk/openai-compatible`, baseURL) with the
  models discovered from `GET :11434/api/tags` and `GET :1234/v1/models`. Permission
  config: `full` → allow all, otherwise `ask` for bash/edit/webfetch (T3's table).
- **Routing** (`packages/decisions/src/router.ts`): engines come from
  `ctx.availableEngines`; the route question lists each engine's descriptor (local/slow)
  so Jev can weigh it; continuity rule D-022 unchanged.
- **UI**: Setup/Settings get one card per engine from the descriptors (installed / logged
  in / login command / local server reachable), a "Custom ACP engine" form, and the bot
  Profile engine select lists them with the model list from `listModels()`.
- **Errors**: CLI missing → status only; agent crash → turn `failed` with the last
  stderr lines (redacted); auth required (`authMethods` non-empty and prompt fails with
  auth error) → `authFailure: true` with the login command.
- **Compatibility**: fixed-enum consumers (`engines/common/auth.ts`, store setup repo,
  `ws.ts`, UI setup) switch to descriptors; `claude`/`codex` stay first and unchanged.
- **Discarded alternatives**:
  - *Our own agent loop over OpenAI-compatible APIs* for local models — we'd have to build
    file/shell tools, a sandbox and context management that the CLIs already have.
    Revisit only if OpenCode proves unusable with small models.
  - *OpenCode via its HTTP server + SDK* (what T3 does) — richer, but a second transport
    to maintain; ACP covers it with the same code as Cursor. Switch if ACP lacks something.
  - *One driver package per CLI* — duplicates the protocol code (T3 shares one runtime).

## Tasks

| # | Task | Likely files | Verification | Depends | Parallel |
|---|------|--------------|--------------|---------|----------|
| 1 | Spike: drive `opencode acp` by hand with the official SDK: initialize, session/new with an MCP stdio server, prompt, permission request, cancel, load; record JSONL fixtures (no credentials) for opencode+Ollama; note Cursor/Gemini/Grok flags from their docs | `packages/engines/fixtures/acp/*`, research note | Fixtures replay; answers to every "verify in T1" item written down | — | no |
| 2 | Contracts: open `EngineId`, `EngineDescriptor`, `describe()`; fake engine implements it | `packages/contracts/src/{entities,engine-driver}.ts`, `engines/fake` | `pnpm typecheck`, contract tests | 1 | no |
| 3 | Store migration 0004 (`engine_setup`, `custom_engines`) + repos, fallback to old columns | `packages/store` | `db:check`, repo tests, migrate a copy of a real `~/.openbot` | 2 | yes (with 4) |
| 4 | `@openbot/engines-acp`: driver core (spawn, session lifecycle, update→event mapping, permission, cancel, steer queue) against a scripted fake ACP agent | `packages/engines/acp/src/*` | unit tests + conformance suite passes on the fake agent and on T1 fixtures | 2 | yes (with 3) |
| 5 | OpenCode profile + local models (private config, Ollama/LM Studio discovery, permission table) | `packages/engines/acp/src/profiles/opencode.ts` | unit tests; opt-in live test `OPENBOT_E2E_REAL=1` with Ollama `qwen3:8b` | 4 | no |
| 6 | Wire into harness: `providers.ts` registry of drivers/descriptors, `turn-mailbox` auth/env per engine, `auth.ts`, doctor, `ws.ts` statuses | `apps/server/src/*`, `packages/core` | unit tests; `openbot doctor` lists engines | 3,4 | no |
| 7 | Router: descriptor-aware route question, only ready engines | `packages/decisions/src/router.ts`, question builders | router tests incl. local engine | 6 | yes (with 8) |
| 8 | UI: engine cards, custom ACP form, profile engine/model select, mock server parity | `packages/ui/src/components/{setup,settings,profile}`, `mock/*` | UI tests; E2E: create Bot on fake ACP engine, chat, approval card | 6 | yes (with 7) |
| 9 | Cursor, Gemini, Grok profiles (+ Cursor transport-failure detection) | `packages/engines/acp/src/profiles/*` | unit tests; live test per CLI when installed (owner machine) | 4 | yes |
| 10 | Live verification on a copy of the real `~/.openbot` (`scripts/live/`): OpenCode+Ollama Bot, Chief delegating to it, approval card, restart+resume; docs (README engines table) | `scripts/live/*`, `README.md`, STATE/DECISIONS | scenario passes; 1 decision D-031 logged | 5–8 | no |

Progress:
- [x] T1 spike
- [x] T2 contracts
- [x] T3 store — not needed: engine columns are free text; custom engines live in `~/.openbot/engines.json`
- [x] T4 ACP driver core
- [x] T5 OpenCode + local models
- [x] T6 harness wiring
- [x] T7 router
- [x] T8 UI
- [x] T9 Cursor/Gemini/Grok profiles — Cursor live 9/9; Gemini to the sign-in error; Grok untested (not installed)
- [x] T10 live verification + docs

## Risks

| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| Agent runs tools without `request_permission` (like Codex read-only MCP tools), so the broker never sees them | high | high | Map presets to the CLI's own permission flags; keep dangerous MCP servers out of the turn; document that ACP engines enforce policy in the agent; later option: advertise `fs`/`terminal` so OpenBot executes them |
| Small local models are bad at tool calling / long agent prompts | high | medium | Mark `local: true`, warn in UI, Jev avoids them for heavy work; recommend ≥8B tool-capable models; T5 live test measures it |
| Owner's global CLI config/plugins/MCP leak into Bots (Codex lesson) | medium | high | Private config dirs per engine, env allowlist, test that a global MCP server is absent |
| ACP flags/versions drift (Cursor, Gemini "experimental") | medium | medium | Version detection, fixtures + opt-in live tests per CLI, clear "update your CLI" error |
| Opening `EngineId` breaks typed consumers or stored rows | medium | medium | Built-in ids unchanged; migration test on a real data copy; typecheck gates |

## Open questions

- Priority: local models first (T5, testable today on this machine) or Cursor first (needs
  `cursor-agent` installed + logged in)? Recommended: local models first.
- Is OpenCode acceptable as the local-model runtime, or does the owner want a pure
  "Ollama" engine without installing OpenCode? Recommended: OpenCode now, native later
  only if needed.
