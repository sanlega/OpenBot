# Registro de decisiones

Decisiones de arquitectura y convenciones. La más reciente, al final.
Formato: fecha, contexto, decisión, consecuencias.

## D-001 · U1: Jev is core and required

- **Fecha**: 2026-09-27

- **Context**: OpenBot v1 plan §2.1. Jev routes engine/model, handles triage/delegation, and runs the spawn/notify/risk/loop/trigger gates and computer-control policy.
- **Decision**: Jev sits behind a `DecisionService`, pinned to `jev-1.13.0`; outages (429/529/timeouts) degrade conservatively (never fail open) per §4.4.
- **Alternatives discarded**: per-purpose ad hoc LLM calls with no shared abstraction; skipping Jev and hard-coding heuristics.
- **Consequences**: every gate call goes through `packages/decisions` (WS7); WS0 ships a fake Jev server so every other workstream can build against the same contract with zero credentials.

## D-002 · U2: Clients are Electron desktop + public Client API

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: an Electron desktop app with the harness embedded, plus a public Client API (HTTP+WS, §4.7) consumed by the phone PWA and other apps.
- **Consequences**: `packages/core` hosts the API; `apps/desktop` and `apps/pwa` are separate thin shells over `packages/ui`.

## D-003 · U3: Remote access has no custom relay

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.8.
- **Decision**: Tailscale is the default (harness on the tailnet, `tailscale serve` for HTTPS); Cloudflare Tunnel is the alternative (`cloudflared` outbound-only + Cloudflare Access). OpenBot's own QR pairing, device tokens, and E2E framing sit on top of either.
- **Consequences**: `packages/remote` (WS11) never runs a server-side relay; Cloudflare's edge TLS termination is why the E2E layer is mandatory, not optional.

## D-004 · U4: Desktop OS parity

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: macOS, Windows, and Linux ship together in v1 with equal priority.
- **Consequences**: CI runs a three-OS matrix from WS0 onward; no OS-specific feature gating in v1 scope.

## D-005 · U5: Bring your own keys and accounts

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: a first-run wizard collects/validates the TypeSafe key (required), Claude login-or-key, Codex login-or-key, Composio (optional), Tailscale/Cloudflare (optional); secrets live in the OS keychain (Electron `safeStorage`) or a 0600 file when headless. The user's own Claude Code CLI login is accepted with no extra policy gate.
- **Consequences**: OpenBot ships no backend and no bundled keys; `packages/engines/auth.ts` supports both login and API-key modes per engine, overridable per Bot.

## D-006 · U6: Computer use behind a Computer SPI

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.5.
- **Decision**: Docker desktop is the default provider (noVNC live view, takeover); the local machine is opt-in, cross-platform, and 'ask every time' by default. Jev runs the fast loop and escalates to the engine or the user.
- **Consequences**: `packages/computer` (WS9) implements both providers behind one SPI; WS0 ships a fake computer with DOM fixtures so other workstreams don't need Docker to build against it.

## D-007 · U7: Isolation follows Grok Bot (shared computer)

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §9 Risks.
- **Decision**: one shared computer and workspace, with a separate screen per Bot. Bots are not a security boundary and the UI says so explicitly. Per-Bot presets still apply.
- **Consequences**: the permission broker (WS2), 'ask' rules, and a persistent UI notice are the actual mitigations, not process isolation.

## D-008 · U8: Chief of Staff is autonomous but selective

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.9, §11.1-11.3 (external report).
- **Decision**: three independent layers, none trusted alone: (1) a prompt ladder ('handle it yourself first'), (2) Jev gates on every create_bot/message_user call, (3) hard caps in code (S1-S10) that Bots cannot see. A refusal is a structured result `{allowed:false, reason, suggestion}`, never an error.
- **Consequences**: `packages/cos` (WS8) owns SpawnGate/NotifyGate; the caps live in Settings and are never exposed to Bots or the model.

## D-009 · U9: Connectors come from a big catalog

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.6.
- **Decision**: a `ConnectorProvider` SPI; v1 ships raw MCP + the MCP Registry, plus Composio. Pipedream is out of scope for v1. Tokens never enter model context.
- **Consequences**: `packages/connectors` (WS10) implements both providers behind the SPI; the `sideEffect` flag on every tool drives the permission broker.

## D-010 · U10: Routines are in v1

- **Fecha**: 2026-09-27

- **Context**: plan §2.1, §4.9 (routines table), workstream WS12.
- **Decision**: Bots run routines on a schedule or event trigger, with a mandatory first dry run, spend caps (O7), and run history.
- **Consequences**: `packages/routines` (WS12) and the `routines`/`routine_runs`/`trigger_events`/`cap_counters` tables are part of WS0's migration 0001, not deferred to a later migration.

## D-011 · U11: Build from scratch

- **Fecha**: 2026-09-27

- **Context**: plan §2.1.
- **Decision**: study prior art (Grok Bot and others), copy no code. Third-party libraries/images used as dependencies are fine.
- **Consequences**: no vendored code from Grok Bot or similar products; only npm/pip/image dependencies declared normally in package manifests.

## D-012 · Harness setup: metaharness with agents+Claude adapters

- **Fecha**: 2026-09-27

- **Context**: OpenBot includes its reusable agent workflow under `.ai/`; contributors may use Claude Code, Codex, Cursor, or any compatible editor.
- **Decision**: `.ai/` is the single source of truth. `ADAPTERS="agents claude"`: `AGENTS.md` covers Codex, Cursor, and other agent-file readers; `CLAUDE.md` + `.claude/` cover Claude Code (hooks: brief at session start, guard before risky tools, stop-check at the end). Skills are generated into `.claude/skills/` and `.agents/skills/`. Hooks and `.mcp.json` invoke `bash .ai/bin/mh ...` (not the file directly) so they still work if the executable bit on `.ai/bin/mh` is ever lost (e.g. some archive/zip extraction or Windows checkouts).
- **Alternatives discarded**: all five adapters (gemini, copilot, cursor too) — more generated files with no current user; add later with `mh sync` after editing `.ai/config`.
- **Consequences**: after editing `.ai/context`, skills, or `.ai/config`, run `bash .ai/bin/mh sync`; CI runs `mh check` and fails on adapter drift.

## D-013 · TypeScript 6.0.3 instead of 7.x

- **Fecha**: 2026-09-27

- **Context**: TypeScript 7 (the native/Go port) is `latest` on npm, but `typescript-eslint`@8.70.1's peer range is `>=4.8.4 <6.1.0`.
- **Decision**: pin `typescript@6.0.3` in the root and every package until typescript-eslint supports TS 7.
- **Alternatives discarded**: TS 7 now with a bare `tsc`-only lint setup (loses type-aware ESLint rules, not worth it for a project this size).
- **Consequences**: revisit this decision once `typescript-eslint` publishes TS 7 support; track via `npm view typescript-eslint peerDependencies`.

## D-014 · pnpm lockfile is committed from the bootstrap onward

- **Fecha**: 2026-09-27

- **Context**: an earlier bootstrap attempt on this project had no git push credentials and had to write files through the GitHub API one by one, which cannot include a generated `pnpm-lock.yaml` (it would need a real `pnpm install` run first, then a byte-exact upload).
- **Decision**: this bootstrap has real `git`/`gh` credentials (fine-grained PAT with Contents+PRs+Workflows write), so `pnpm install` runs for real and `pnpm-lock.yaml` is committed like any normal Node project. CI uses `pnpm install --frozen-lockfile`.
- **Consequences**: every future dependency change must run through `pnpm add`/`pnpm install` locally (or in CI with lockfile checks) so the committed lockfile stays exact; no manual hand-edits to `pnpm-lock.yaml`.
## D-015 · WS0 fakes for engine/computer live in nested packages/<ws>/fake sub-packages

- **Fecha**: 2026-09-27

- **Contexto**: plan §3 lists `engines/` (WS3) and `computer/` (WS9) as single packages with `(fake/ = WS0)` noted inline, without specifying whether the fake is its own npm package or a subfolder of the same one.
- **Decisión**: `packages/engines/fake` and `packages/computer/fake` are their own npm packages (`@openbot/engines-fake`, `@openbot/computer-fake`) rather than subfolders inside a single `@openbot/engines`/`@openbot/computer` package. `pnpm-workspace.yaml` gained a `packages/*/*` glob for this.
- **Alternativas descartadas**: cramming `fake/` as a subfolder of a not-yet-existing `@openbot/engines`/`@openbot/computer` package, which would force WS3/WS9 to either reuse WS0's package.json (coupling their release/dep graph to the fake) or restructure it when they land.
- **Consecuencias**: WS3/WS9 add sibling packages (`packages/engines/claude`, `packages/engines/codex`, `packages/computer/docker`, `packages/computer/local`, etc.) without touching or moving the fakes; each engine/provider backend can have its own dependencies.

## D-016 · apps/desktop's WS0 skeleton stubs the electron dependency

- **Fecha**: 2026-09-27

- **Contexto**: plan §5 WS0 requires "An Electron shell and a headless shell" with acceptance "the desktop shell shows harness connected", while the full desktop shell (utilityProcess host, tray, notifications, packaging) is explicitly WS6's job. The real `electron` npm package downloads a large (~100 MB+), OS-specific binary via its postinstall script.
- **Decisión**: `apps/desktop` ships real, structurally-correct main/preload/renderer code (one window, one IPC handler) typechecked against a local ambient `electron-shim.d.ts` instead of depending on the real `electron` package. The actual "is the harness connected" logic is extracted into `harness-client.ts` and unit-tested with Vitest; the Electron window itself cannot be driven headlessly in this sandboxed environment. See `apps/desktop/README.md`.
- **Alternativas descartadas**: adding the real `electron` devDependency now, which would make `pnpm install`/CI depend on a large binary download (repeated across the 3-OS CI matrix) for a skeleton WS6 will rewrite anyway, with no way to verify the display output in this environment either way.
- **Consecuencias**: WS6 adds the real `electron` dependency and deletes `electron-shim.d.ts` when it lands; until then, `apps/desktop`'s build/typecheck/test are fast and 100% reliable in CI, but the GUI itself is unverified end-to-end.

## D-017 · WS6 harness host forks `@openbot/server` dist/main.js; preload is CommonJS

- **Fecha**: 2026-09-27

- **Contexto**: plan §5 WS6 requires the harness in an Electron `utilityProcess` with auto-restart. WS0's desktop skeleton used a local `electron-shim.d.ts` (D-016). Electron preload scripts cannot reliably use ESM `import` under `contextIsolation` when the app package is `"type": "module"`.
- **Decisión**: `HarnessHost` forks `@openbot/server/dist/main.js` via `utilityProcess.fork` (not a separate worker shim). Preload compiles to `dist/preload.cjs` (CommonJS) via `tsconfig.preload.json`. Main waits on `waitForHarnessReady()` before showing the window.
- **Alternativas descartadas**: bundling the whole harness into the main process (violates E3); keeping preload as ESM (broke IPC bridge in Playwright `_electron` smoke tests).
- **Consecuencias**: `apps/server/package.json` exports must include `require`/`default` conditions so `createRequire` can resolve the entry at runtime; desktop `build` runs two `tsc` passes.

## D-018 · Desktop runtime must bundle Node 22 for better-sqlite3 13

- **Fecha**: 2026-09-27

- **Context**: `better-sqlite3@13.0.3` declares Node `>=22`, while Electron 34.2.0 embeds Node 20.18.2. On macOS arm64, `rebuild:native` succeeded but loading SQLite under Electron crashed the packaged harness with SIGSEGV. The packaged app never opened its Client API.
- **Decision**: Pin `apps/desktop` to Electron 38.8.0, which embeds Node 22.22.0. After rebuilding the native module, run a real SQLite query with `ELECTRON_RUN_AS_NODE=1` before packaging.
- **Alternatives discarded**: keep Electron 34 and downgrade SQLite; this would widen the package's dependency divergence and leave the embedded runtime behind the monorepo's Node 22 baseline.
- **Consequences**: desktop packaging requires an Electron runtime compatible with the store's native SQLite package. `rebuild:native` now fails if that runtime cannot load and query SQLite.

## D-019 · Connectors: open MCP only, no Composio (supersedes D-009)

- **Fecha**: 2026-09-27

- **Context**: D-009 shipped raw MCP + MCP Registry plus Composio. Composio is closed source and hosted; the owner wants open, user-owned integrations. A market survey found vendors now host their own remote MCP servers with OAuth (GitHub, Notion, Linear, Atlassian, Slack, Sentry, Stripe…) and every major client pairs a curated gallery with "paste a URL/command".
- **Decision**: remove the Composio provider. Connectors are MCP servers only: a curated first-party catalogue (vendor remote servers + local stdio), the MCP Registry as an unverified "Community" tab, and custom connectors. OAuth for remote MCP is implemented inside OpenBot (PKCE, client-ID metadata document or dynamic registration, loopback callback). Connections are per account, assigned per bot; write tools go through the permission broker.
- **Consequences**: no hosted middleman or third-party key; Google/Slack/GitHub need a guided client setup or a published OpenBot OAuth client id; plan in `.ai/memory/plans/2026-09-28-connectors.md`.

## D-020 · Docker desktop image distributed via GHCR

- **Fecha**: 2026-09-28

- **Contexto**: `packages/computer/docker`'s `ensureStarted()` calls `docker.createContainer()` directly against `openbot/desktop:latest` with no pull/build step; the image is not published anywhere, only buildable manually from the full monorepo (`images/desktop/Dockerfile` uses the repo root as build context). The owner asked for a Settings action to get/reset this image; a packaged install has no monorepo source to build from.
- **Decisión**: publish the desktop image to GHCR (`ghcr.io/sanlega/openbot-desktop`) from CI on release tags; the app's default image reference points at that registry and `docker pull`s it on demand. A local `docker build` from `images/desktop/Dockerfile` remains available only as a dev-checkout convenience (detected by walking up from the running package to find that Dockerfile), not the primary path.
- **Alternativas descartadas**: bundling the full monorepo source into the Electron installer so the packaged app could `docker build` itself — much larger installer, slow/fragile first run (needs network + apt + pnpm install inside the build), no benefit over a prebuilt registry image.
- **Consecuencias**: adds a `packages: write`-permissioned CI job publishing on `v*` tags; the GHCR package likely inherits the repo's current private visibility and needs a one-time manual switch to public after the first publish (repo is private pending the GitHub Support ref-purge noted in STATE.md) or pulls will fail with an auth error the UI must surface clearly. Plan: `.ai/memory/plans/2026-09-28-computer-image-settings.md`.

## D-021 · Replace the public repo instead of waiting on GitHub Support

- **Fecha**: 2026-09-28

- **Contexto**: history cleanup rewrote all 18 branches of `sanlega/OpenBot` to remove personal data, but GitHub's own `refs/pull/1..18/head` kept pointing at the pre-rewrite commits and can't be deleted by the owner (`git push origin :refs/pull/N/head` → "deny updating a hidden ref"); only GitHub Support can purge them. The owner made the repo public before that purge happened, so the exposure was live. A Support ticket was filed, but its timeline is unknown/slow.
- **Decisión**: rename the old repo to `sanlega/OpenBot-old` and set it private (verified inaccessible anonymously), then create a brand-new `sanlega/OpenBot` (same owner+name) and push only the current clean `main` as its history. A repo with no PRs ever opened against it has zero `refs/pull/*` refs and can never inherit this exposure, independent of whether/when Support ever purges the old refs.
- **Alternativas descartadas**: waiting on the Support ticket while keeping the repo public — open-ended timeline with real data exposed the whole time; flipping the old repo back to private without replacing it — stops the bleeding but permanently blocks going public again without still depending on that same unresolved Support request.
- **Consecuencias**: negligible loss (the old repo was 2 days old: 0 issues, 0 releases, 0 forks, 1 star; all PR branches were already merged into `main`, only PR discussion metadata was left behind). README/CI-badge links needed no edits since owner+name are unchanged. Local `origin` now points at the new repo. `OpenBot-old` stays private as an internal-only backup of the pre-migration history/PR metadata. The account-level GitHub Actions billing block (unrelated, pre-existing) still needs checking on the new repo.

## D-022 · Routing continuity: tell Jev the currently active engine instead of hardcoding a sticky rule

- **Fecha**: 2026-09-29

- **Contexto**: live testing found that Jev's "auto" engine routing switched the Chief of Staff from Codex to Claude on a follow-up "continua" message, and Claude had zero memory of the multi-step task Codex had been doing (research, writing a report file) -- session resumption is per bot+engine pair (engine_sessions), so switching engines mid-conversation always starts a blank session. The user asked for "shared context so it doesn't lose the thread," and accepted a simpler sticky-engine rule as a good fallback if that's too much.
- **Decisión**: rather than hardcoding a sticky-engine rule that bypasses Jev (against this project's "let Jev make the fuzzy call" philosophy), extended `RouteContext` (packages/contracts) with optional `currentEngine`/`currentEngineIdleMinutes`, computed in `apps/server/src/turn-mailbox.ts`'s `chooseEngine()` from whichever available engine has the most recent `engine_sessions` row for this Bot. The `route` Jev question's instructions (packages/decisions/src/questions/route.ts) now explicitly weigh this: strongly prefer `state.currentEngine` unless `state.task` is clearly a new, unrelated request, calling out that switching loses that engine's own conversation memory even for a short "continue".
- **Alternativas descartadas**: a hardcoded sticky-engine rule in code (always keep the same engine for the whole thread) -- simpler, but removes Jev's ability to route a genuinely different follow-up request to a better-suited engine, and doesn't match how every other nuanced call in this codebase already goes through Jev.
- **Consecuencias**: this only changes what Jev is told, not a hard rule, so its effectiveness depends on Jev actually weighing it (real Jev only -- FakeDecisionService/tests can't verify Jev's judgment, only that the signal reaches `state`). The deeper "shared context" idea the user also raised (injecting a recent-conversation summary into a fresh session regardless of which engine runs it) is not implemented -- flagged as a possible follow-up if engine switches still lose too much context in practice.

## D-023 · The Chief of Staff delegates by default and may create one-off bots

- **Fecha**: 2026-09-30

- **Contexto**: live use showed the Chief doing whole multi-step jobs itself (research, build, publish), so the owner could not reach it while it worked. The old prompt and `SpawnGate` said the opposite: fewest bots, one-off tasks NEVER get a bot, do it yourself first.
- **Decisión**: the Chief is a dispatcher. It answers only quick things; anything with real work goes to a bot (existing first, else a new one, one-off allowed). `SpawnGate` gained a `substantial_work` Jev question and `substantialWorkMin` threshold so a one-off that is real work passes; a quick one-off is still denied. Default caps loosened (10 Chief-made bots, 8 per day, 2 min cooldown).
- **Alternativas descartadas**: denying the Chief its own shell/file tools to force delegation (too brittle: a refused spawn would leave it stuck).
- **Consecuencias**: more bots on the roster; the caps and `archive_bot` keep it bounded. Verified live with real Jev and Claude: the Chief created a bot, handed it the task, and ended its turn. Tests that are about the S1-S3 mechanics pin their own strict caps.

## D-024 · Website logins live in the vault and are typed by the host

- **Fecha**: 2026-09-30

- **Contexto**: a task needed a signed-in site; the Chief asked the owner to paste the content instead of asking for credentials.
- **Decisión**: `login.<site>` in the vault (packages/core `logins.ts`) holds username and password. Bots use `list_logins` / `save_login` / `forget_login` (MCP) and `ask_user` secret fields (`secret:` refs). `ComputerTaskManager` resolves `secret:` inputs and the saved login for the page being typed into (by observation URL, host then parent domains) at the moment of typing; a password typed on an approval card is shown as "(hidden)". Owner routes `GET/PUT/DELETE /api/logins` and Settings > Computer > Saved logins; no route returns a password.
- **Alternativas descartadas**: passing passwords to the engine as tool arguments (the model would see them).
- **Consecuencias**: 2FA/CAPTCHA still go to the owner. Verified live in the real VM with real Jev: a login page on the host was signed in with the saved login and the task snapshot never contained the password.

## D-025 · A VM-only Bot stays off the host's browser

- **Fecha**: 2026-09-30

- **Contexto**: a Bot with only the virtual machine enabled drove a Playwright browser and opened URLs on the owner's own computer.
- **Decisión**: `BrokerRequest.computerAccess`; a built-in deny (wins over every preset, including Full) for browser-automation tools (`playwright`, `puppeteer`, `browser_*`) and shell commands that open a browser, for Bots whose computer is not `docker+local`. The prompt adds a VM-only block. Also: the Full preset now really means no cards (connector side effects and local-computer asks skipped; sensitive computer targets still ask), the live preset is read at decision time, and `AskUserQuestion` is read-only.
- **Alternativas descartadas**: running the whole engine inside the VM (real isolation, but a much larger change; tracked as a follow-up issue).
- **Consecuencias**: the shell still runs in the Bot's workspace on the host; only browser/desktop control is fenced.

## D-026 · Docker Desktop is started for the owner, and a failed display no longer kills the daemon

- **Fecha**: 2026-09-30

- **Contexto**: a computer task failed with a raw `ENOENT //./pipe/docker_engine`; separately the desktop container had exited after a VNC start-up error thrown outside any handler, then failed again on stale X/Chromium locks.
- **Decisión**: `ensureDockerEngine` starts Docker Desktop (Windows/macOS) and waits, or says plainly what to do. In the image: `/live` catches display errors, `unhandledRejection` is logged, a failed display start is forgotten so the next call retries, and stale X and Chromium profile locks are removed before start.
- **Consecuencias**: the local image was rebuilt and tested (crash with `docker kill`, restart, task still works). Per-turn step limit raised 50 to 200 and Claude's `error_max_turns` is reported in plain words.

## D-027 · Codex Bots run from a private CODEX_HOME with OpenBot's own thread parameters

- **Fecha**: 2026-09-30

- **Contexto**: on the owner's machine every Codex Bot (the Chief included) was useless. Root causes found with the real CLI (0.155): the parser only knew old notification names (every reply empty); `thread/start` sent no instructions (the Bot never heard of OpenBot); MCP tool calls arrive as `mcpServer/elicitation/request` and were answered in the command shape, so Codex read them as rejected (OpenBot's tools never worked); the owner's `~/.codex` leaked in (a personal "Sites" plugin, MCP servers that drive their screen, global instructions, `approval_policy = never`), and Codex's default sandbox blocked the network.
- **Decisión**: (1) a private `<OPENBOT_HOME>/codex-home` with only the login (kept in step with the owner's by newest mtime, both ways) and a minimal config; (2) `thread/start` gets `developerInstructions` = the Bot's prompt, `approvalPolicy: "untrusted"`, sandbox `danger-full-access` (`read-only` for read-only Bots), and OpenBot's MCP server, so OpenBot's broker is the policy exactly as with Claude; (3) `mapApprovalRequest` names commands `shell` (wrapper unwrapped), patches `apply_patch` with paths, MCP calls `mcp__<server>__<tool>`, and answers each in its own shape; OpenBot's own tools are auto-allowed in the mailbox; (4) notifications and approvals are filtered by thread (one app-server serves every Bot); (5) a `ThreadIndex` records what each thread was created with, and a thread is reused only if its MCP servers/sandbox match (Codex fixes them at creation: resume changes nothing), while changed instructions ride in front of the message; (6) the MCP shim reads the per-turn token from a file because a Codex thread keeps its MCP process across turns.
- **Alternativas descartadas**: overriding the owner's config per thread (plugins/MCP cannot be listed reliably); Codex's own workspace-write sandbox (blocks the network and needs a Windows setup a private home lacks); a fresh thread every turn (loses Codex-side memory).
- **Consecuencias**: existing Codex threads (made without instructions or tools) are not reused: one fresh thread per Bot after upgrading. Verified live with the real CLI: text and tool events, instructions, MCP call, approval routing, resume, two Bots at once, and a Codex Chief delegating through OpenBot's tools over two turns. `codex.live.test.ts` (OPENBOT_E2E_REAL=1) guards the next Codex update.

## D-028 · New Bots default to Full permissions and the virtual machine

- **Fecha**: 2026-09-30

- **Contexto**: the owner's rule: unless configured otherwise, every Bot has full permissions and works inside the virtual machine.
- **Decisión**: the Client API and the Chief's `create_bot` default to `permissionPreset: full` and `computer: docker`; the Chief itself is created that way. Existing Bots are untouched. Built-in denies, sensitive targets and the VM-only host-browser fence (D-025) still apply. Shell execution inside the VM is issue #8; a Settings-level default and the reset button are #9 and #10.
- **Consecuencias**: the permission-flow E2E scenarios now create their Bots with `workspace_write` explicitly.

## D-029 · Delegation is a tracked, bidirectional task: the harness decides its state and returns the outcome

- **Fecha**: 2026-09-30

- **Contexto**: live, the Chief delegated a job and asked the user for credentials, then the worker stopped and nothing reached the Chief or the user. Delegation was fire and forget: the only way back was the worker model choosing to call `send_message`; a worker's `message_user`, forms and approval cards landed in the worker's own thread; `request_approval` crashed on a duplicate row; `maxHops` 4 paused the chain after two round trips; refused turns vanished. Research (OpenClaw, Hermes Agent, Claude Code subagents/teams, Codex multi-agent, A2A, MCP tasks/elicitation, LangGraph, Temporal) agrees: the requester owns the human conversation, task status comes from the runtime, results return as a new turn, worker questions surface in the requester's view, credentials stay out of band.
- **Decisión**: a `delegations` table (migration 0003) and `DelegationTracker` in `@openbot/core`. `send_message` opens or continues a delegation (caps: 5 open per requester, 8 round trips). The state (submitted, working, input_required, completed, failed, interrupted) is set by the runtime from how the worker's turn ends; a refused or failed turn fails it. On a terminal or blocker state the harness posts a card in the requester's thread (the one the user is in) and wakes the requester once (`wake_pending` is persisted and claimed atomically, so a restart neither loses nor repeats it); the wake turn runs on its own chain, and a reply of exactly `NO_REPLY` is dropped. A delegated worker's `message_user` goes to its requester, and its `ask_user` form, `request_approval` (now kind `bot_request`) and broker permission cards show in the requester's thread while the task is `input_required`; the user's answer resumes the worker on the same engine and delegation. Restart marks running tasks interrupted; a sweep flags a working task silent for 10 minutes. The Chief is never rerouted. Prompts now say results come back on their own.
- **Alternativas descartadas**: a `task_complete` tool the worker must call (models forget it: state comes from the runtime, `implicit` results are fine); a separate outbox table (the wake flag on the row is enough with one consumer); waking the requester on progress (cost).
- **Consecuencias**: the worker's closing text is now returned to the requester; a worker that ends with no closing message says so and the requester is told to ask. Not built: a cancel tool and cascade, a task board in the UI, depth limits. Codex does not expose shell output for `unifiedExecStartup` commands (`aggregatedOutput` is null and there are no output deltas), so Activity shows none. `OPENBOT_CODEX_TRACE_FILE` dumps the raw app-server lines.

## D-030 · Autonomy by default: the request is the permission, tasks recover and pause only for data

- **Fecha**: 2026-09-30

- **Contexto**: the owner had to babysit every task. Causes found in code and in the owner's own history: the Jev computer loop ended a task (`escalated`) on the first doubt, failed click or stalled page; a login, code or CAPTCHA ended it for good (`takeover`) and nothing resumed it; approval cards fired on label substrings (`send`, `confirm`, `buy`) and on a Jev "destructive" question that counted "send something to other people"; prompts told bots that OpenBot asks the user before risky steps, with no recovery protocol; a Bot could run several computer tasks on its one screen at once.
- **Decisión**: (1) the fast loop recovers before giving up: a second look, then the most likely harmless option, wait/Escape/scroll, and it drops a control that failed or changed nothing on that page (`maxRecoveries` 4 consecutive setbacks, 120 steps); (2) steps only a person can do are classified (login, code, captcha, payment, other) and *pause* the task (`needs_user` with a structured `need`), which resumes by itself when the page shows it done (the user signed in inside the VM) or on `computer_steer`; a sign-in field with no saved login pauses as a login instead of asking the engine for text, and `blocked` is not offered when a saved login will be typed; (3) a task that stopped short resumes in place (same page, same history) on `computer_steer`, and a new task replaces the same Bot's unfinished one; (4) every MCP task result carries `next`, the harness's instruction for that state; (5) sensitive computer targets are only paying and deleting (whole words, several languages) and the Jev destructive question excludes what the goal asks for; (6) a shared `AUTONOMY_PROTOCOL` (contracts) for every Bot and the Chief: act on what the request implies without asking, recover with at least three different approaches, verify against the definition of done, ask the user only for data, once.
- **Alternativas descartadas**: a site-specific flow (the owner asked for none); asking the engine for every doubt (slow, and it is what made tasks look stuck); dropping cards entirely (spending money and deleting data still ask).
- **Consecuencias**: verified live on a copy of the owner's `~/.openbot` with the real Chief, real Jev and the real Docker VM against a local LinkedIn-like site: sign-in with credentials asked once by a secret form and saved; saved login with no question; the user signing in inside the VM; a hostile variant (premium pop-up, hidden list, non-connectable first rows). All ended on the right person with 0 approval cards. Also live: an explicit "let a bot handle it" request (the Chief created a worker, the worker's secret form showed in the Chief's chat, the worker saved the login and finished; 0 cards) and "delete my account" (no card until the final "Delete account permanently" button; denied, nothing deleted). (7) Only the control that commits a deletion or payment asks: links, tabs and menu items never count as destructive or sensitive, and Jev judges the single action, not the goal (a deletion goal had made "Sign in" and "Settings" ask). (8) A Bot whose computer is the VM never gets a browser-automation connector (the curated Playwright connector opened Chrome on the owner's desktop: Codex runs read-only MCP tools without asking, so the broker's host-browser deny never saw them) nor engine browser integrations (`denyTools`). Not covered: real third-party sites with bot defences.
