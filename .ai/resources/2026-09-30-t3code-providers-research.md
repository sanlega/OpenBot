# T3 Code providers research (2026-09-30)

Source: `github.com/pingdotgg/t3code` (MIT, commit c18e5ea6 of 2026-09-30), read locally.
Goal: learn how an open harness supports many agent CLIs, to add Cursor, other CLIs and
local models to OpenBot.

## What T3 Code supports and how

| Provider | Transport | Launch | Auth |
|---|---|---|---|
| Claude Code | Claude Agent SDK / stream-json | `claude` | `claude auth login` |
| Codex | `codex app-server` JSON-RPC (own `effect-codex-app-server` pkg) | `codex app-server` | `codex login` |
| Cursor | **ACP** over stdio | `cursor-agent [-e endpoint] [--force \| --auto-review] acp` | `agent login`, ACP auth method `cursor_login` |
| Grok Build | **ACP** over stdio | `grok [--permission-mode default\|acceptEdits\|auto] agent [--always-approve] stdio` | `grok login` |
| Antigravity (Google) | **ACP** + own protocol extensions | managed install | Google sign-in, per-instance profile |
| OpenCode | OpenCode HTTP server + `@opencode-ai/sdk/v2` | `opencode serve --hostname --port`, config via `OPENCODE_CONFIG_CONTENT`, password via `OPENCODE_SERVER_PASSWORD` | `opencode auth login` |

Key point: three of six providers share one generic ACP runtime
(`apps/server/src/provider/acp/AcpSessionRuntime.ts`, ~1.3k lines) plus a small
per-provider "support" file (spawn args, auth method id, model selection quirks).
ACP = Agent Client Protocol (JSON-RPC over stdio, Zed). Official TS SDK:
`@agentclientprotocol/sdk` (Apache-2.0). Other CLIs that speak ACP: `opencode acp`,
Gemini CLI, Goose, Qwen Code, Copilot CLI, and adapters for Claude/Codex.

T3 Code has no direct local-model driver. Local models (Ollama, LM Studio) are reached
through OpenCode, whose config can declare any OpenAI-compatible provider.

## Architecture ideas worth copying

- **Driver kind vs instance**: a driver is an integration (`cursor`), an instance is one
  configuration/account of it. Route work by instance so two accounts never share
  session or catalog state. (OpenBot can start with one instance per driver.)
- **Built-in driver list** (`builtInDrivers.ts`): adding a provider = one driver file +
  one array entry; unknown drivers in settings surface as "unavailable", not a crash.
- **ACP MCP injection**: `session/new` gets `mcpServers` (T3 passes its own MCP server as
  HTTP url + auth header; stdio is the mandatory ACP form and matches OpenBot's shim).
- **Permission mapping**: runtime mode maps to CLI flags (Cursor `--force` = full access);
  ACP `session/request_permission` is answered with the provider's **native option id**
  (a display label is not a valid reply).
- **Health checks must not do setup**: probing must not open sessions, start MCP servers
  or launch a login browser (Grok, Antigravity).
- **Isolation**: strip ambient credentials/config per instance (Antigravity profile,
  OpenCode server per thread because MCP registration is directory-scoped; OpenCode
  approval grants use `once` so they cannot widen permissions on a shared server).
- **Cursor quirk**: transport failures arrive as assistant text
  (`Error: ConnectError: [unavailable] ...`); T3 detects a reply made only of such a
  dump and turns it into an error (`CursorTransportFailure.ts`).
- **Model manifest**: bundled JSON catalog, optionally refreshed remotely; Codex models
  come from the app-server, ACP models from `session/new` config options / `setModel`.

## Local machine facts (dev box)

`opencode` 1.18.31 (has `opencode acp`), Ollama (`gemma3:4b`, `qwen3:8b`) and
LM Studio (`lms`, 6 models incl. `qwen/qwen3.5-9b`, `zai-org/glm-4.7-flash`) are
installed; Cursor, Gemini and Grok CLIs are not.
