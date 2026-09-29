# Project state

_Last updated: 2026-09-29 by Claude_

## In progress
- **v0.1.1 released and installed on the Windows dev machine (2026-09-29)**: tag `v0.1.1`
  (release workflow green, all installers + `SHA256SUMS` published) — carries the
  spawn-gate near-miss fix, the opt-in routine budget switch, the silent-turn fallback
  line and the engine-continuity routing hint. `main`'s CI had one red job
  (`test (ubuntu-latest)`) that was only the known flaky Unhandled Rejection with all
  843 tests passing (see LESSONS.md).
- **Codex protocol drift fixed (2026-09-30, after v0.1.8)**: the owner's Chief returned
  "Finished without returning any text" on a real request. Cause: Codex CLI 0.155 streams
  `item/agentMessage/delta` (string) and `item/started|completed` items; the parser only knew
  the old names, so every Codex turn had no text and no tool events (an 8-minute turn shown as
  empty). `parse-events.ts` now reads the new shapes (agent text, commandExecution,
  mcpToolCall, fileChange, webSearch, final messages from `turn/completed`) and ignores other
  threads' notifications/approvals (the shared app-server serves every Bot). Verified live
  with the real CLI: text + tool events, two Bots at once without mixing, resume after an
  app-server restart. Opt-in `codex.live.test.ts` (OPENBOT_E2E_REAL=1) guards future drift.
  Needs a release (v0.1.9) to reach the installed app.
- **Autonomy backlog #1-#7 fixed in code, unreleased (2026-09-30)** (commits 22667ca..45c804e
  on `main`; decisions D-023..D-026). #6 turn failures are explained (Claude
  `error_max_turns` wording, Codex thread resume/replace, step limit 50 to 200); #2 Full
  really means no cards (connector side effects and local-computer skipped; live preset
  read per action; `AskUserQuestion` read-only); #3 VM-only Bots are denied host browsers
  (Playwright/`browser_*`/opening a URL from the shell); #4 Docker Desktop is started for
  the owner and the desktop daemon survives a failed display (stale locks removed); #1 the
  Chief delegates by default (`substantial_work` Jev question, looser caps 10/8 per day/2
  min); #5 saved logins (vault `login.<site>`, MCP `list_logins/save_login/forget_login`,
  `secret:` refs, typed by the host in the VM, Settings > Computer > Saved logins).
  **Verified live**: local image `openbot-desktop:local` built and run; a real VM task
  signed in to a host login page with the saved login (real Jev; password never in the
  snapshot); killed the container with `docker kill` and it recovered; stopped Docker
  Desktop and `ensureDockerEngine` started it; real Claude CLI under Full ran a `curl`
  without a card (control bot under workspace_write got one); real Chief created a bot,
  sent it the job and ended its turn. Full pipeline: 934 unit tests, 18 E2E, lint 0
  errors. **Deferred on purpose**: the engine's shell still runs on the host (issue #8).
  **Independent review done** (a verifier agent, twice): its first pass FAILED on two
  high findings (a typed password could reach Jev via the next observation; `secret:`
  refs could read any vault key) plus medium ones; all fixed and re-verified (PASS WITH
  FINDINGS, then the rest fixed): password fields masked at the source and typed secrets
  masked in every observation, `secret:` only resolves `input.*`, Bots can add but never
  overwrite/remove a login (no `forget_login`), logins match the exact host (plus sign-in
  subdomains), https only, wider host-browser fence (also inside `sh -c`), the new caps
  actually apply (defaults 10/8/2 plus a one-time upgrade of untouched 6/2/30). Known
  residuals (low, accepted): masking is by substring; a secret typed into an unrelated
  field is not hidden on an approval card; ports are ignored when matching a login; the
  host shell fence is best-effort until #8.
  Not yet done: release (owner approval) and the desktop image must be republished to
  GHCR for other users (`v*` tag does it; the daemon and DOM-reader fixes live in it).
- **v0.1.5 released and installed; remote access verified live (2026-09-29)**: the owner
  paired the iPhone app over LAN (v0.1.2 ported the native sealed pairing + scoped E2E
  from `sanlega/openbot-ios`; plan there:
  `openbot-ios/.ai/memory/plans/2026-09-29-windows-host-native-pairing.md`, T1-T4 done) and
  then through a Cloudflare Tunnel. Releases this session: v0.1.1 (spawn-gate/routine budget
  fixes), v0.1.2 (native pairing protocol + `http://` QR link on LAN), v0.1.3 (real
  Cloudflare tunnel tokens are base64 JSON, not dotted JWTs), v0.1.4 (`cloudflared` is
  downloaded on first use into `~/.openbot/bin`, pinned version + SHA-256, PATH copy
  preferred), v0.1.5 (tunnel public hostname in the QR: parsed from cloudflared's
  "Updated to new configuration" log, or entered in Devices > Remote access, stored in
  `network.json`; `network.json` is now written atomically and merged).
  Still open: (a) a 401 on the browser UI over the LAN URL shows "Can't reach
  OpenBot…Retrying" instead of an "unpaired device" screen; (b) confirm E2E streams recover
  after a harness restart while the phone stays connected; (c) the tunnel token is not
  persisted, so the tunnel stops when the app restarts (re-paste it); (d) `cloudflared`
  download is untested on macOS/Linux (hashes come from Cloudflare's release digests;
  macOS uses `tar`); (e) a tag push sometimes fires two Release runs, the second fails with
  "release already exists" (harmless).
- **Round 2 of live testing (2026-09-29), fixed two more real bugs found this way**:
  - **Spawn gate near-miss**: asked the Chief of Staff to run two open-ended,
    recurring-sounding tasks without telling it to spawn bots. Jev answered
    `route: new_bot` at **0.97** confidence and `recurring_ownership: 0.98`, but
    `packages/cos/src/spawn-gate.ts`'s old all-thresholds-must-pass rule denied the
    spawn anyway because `existing_can_do` landed at 0.32 — 0.02 over its 0.30
    ceiling. **Fixed**: a very confident `new_bot` answer (≥0.9) now tolerates
    `existing_can_do` up to 0.5 instead of an absolute 0.3 veto; the one-off/
    duplicates/recurring checks are unchanged either way. Regression-tested with the
    exact 0.97/0.32 numbers from this session's decisions table.
  - **Routine per-run budget was interrupting real progress**: the same test's weekly
    code-audit routine got cut off mid-task by its own cost/token cap right after
    writing a genuinely good, accurate update to the audit file — the interruption
    looked like failure even though it wasn't. **Fixed**: `Bot.limits` gained an
    opt-in `unrestrictedRoutineBudget` switch (off by default; toggle lives in the
    bot's Profile in the UI) that skips this cap for that bot's routine runs. Needed
    a new store migration (`0002_lethal_madelyne_pryor.sql`).
  - Also independently confirmed during this same session that the actual generated
    work (a changelog entry, a 3-package dead-code audit) was genuinely good quality —
    the "interrupted"/"couldn't finish" labels were budget guards working as designed,
    not the model failing at the task. See LESSONS.md for the debugging path (real Jev
    decision rows in `~/.openbot/openbot.db`'s `decisions` table were the key evidence).
  - **Found a real vitest footgun while investigating this**: `pnpm --filter <pkg>
    test` can silently run stale compiled `dist/*.test.js` files instead of (or
    alongside) current `src/*.test.ts` ones — a test-fixture edit didn't take effect
    until the package's `dist/*.test.*` files were deleted. The root `pnpm test`
    (whole monorepo) is unaffected — its config explicitly excludes `**/dist/**` — so
    it's the authoritative check; see LESSONS.md.
  - **Open, not yet investigated**: (1) a "continua" retry after the engine-continuity
    fix (D-022) still needs a live-Jev retest to confirm it actually keeps the bot on
    the same engine now. (2) A Computer task (creating a Twitter/X account) hit a real
    hard blocker (X requires SMS/email verification + a login-vs-signup modal
    ambiguity) and correctly stopped to ask rather than guess — but the owner felt the
    Computer/Jev fast-loop gives up too quickly on ambiguous dialogs in general; worth
    checking the retry/patience budget in `packages/computer`'s fast loop. (3) Owner
    wants to research Firecracker microVMs (https://firecracker-microvm.github.io/) as
    a possible stronger per-bot isolation alternative to the current shared Docker
    desktop container (D-007 says bots aren't isolated from each other today).
  - **Explicitly deferred design conversation (owner's words)**: per-bot permission
    *modes* (today it's one of three fixed presets: `read_only`/`workspace_write`/
    `full`) are too rigid — too many approval prompts for mundane stuff. Two concrete
    ideas the owner raised: (a) if a bot that delegated a task to another bot already
    has a given permission, the delegate should be able to use that same permission
    without asking again; (b) shared/inherited memory between bots in general (not
    just permissions) — e.g. so a `send_message` handoff carries real context, not
    just the handoff text. Neither is designed yet; start here next session if the
    owner wants to continue this thread — it's a real architecture decision, not a
    quick patch (plan-feature territory).
- **v0.1.0 first release, live-tested end to end (2026-09-28/29)**: the owner ran a
  real stress-test prompt on the Chief of Staff (research + Computer use + file write +
  routine creation) against the installed Windows app, which surfaced and got two real
  fixes:
  - **Silent completed turns** — Codex/gpt-5.5 can end a turn on a tool call (e.g.
    writing a file) with no closing assistant message; `packages/runtime/src/mailbox.ts`
    used to skip creating any message at all when reply text was empty, so a turn that
    did real work looked like it returned nothing. Now synthesizes a fallback line
    ("Finished N tool calls but didn't return a summary — check Activity for what it
    did.") so a completed turn is never invisible. Regression-tested.
  - **Engine-switch context loss** — Jev's auto routing switched engines
    (Codex → Claude) on a follow-up "continua", and the new engine had zero memory of
    the prior multi-step task (sessions are per bot+engine). Fixed per D-022: `RouteContext`
    now carries `currentEngine`/`currentEngineIdleMinutes` (the Bot's most recently
    active engine + how idle it's been), and the route question's Jev instructions
    weigh this explicitly against switching. This changes what Jev is *told*, not a
    hard rule — its real effectiveness needs a live-Jev retest of the same "continua"
    scenario, not yet done this session.
  - Confirmed working end to end during this same testing: the Docker/GHCR desktop
    image downloads and starts correctly (`{"ok":true,"maxScreens":4}`), real Computer
    web research happened, a well-sourced report got written (to the wrong place — see
    open item below).
  - **Still open, found but not yet fixed**: the bot wrote its report inside its own
    workspace instead of `~/Desktop/...` "outside the workspace" as asked, and never
    reached the routine-creation part of that multi-part request — the turn appears to
    have ended early rather than continuing through the rest of the task. Root cause
    not yet investigated (could be `~` not expanding before the tool-classifier sees
    the path, a Codex step/turn-limit, or the model just stopping) — pick this up next
    if the owner hits it again.
  - **DONE — v0.1.0 is published**: https://github.com/sanlega/OpenBot/releases/tag/v0.1.0
    (verified via `gh release view v0.1.0`, 2026-09-28T22:34:44Z). Assets: `OpenBot-0.1.0-amd64.deb`,
    `-arm64.dmg`, `-x64.dmg`, `-x64.exe`, `-x86_64.AppImage`, `SHA256SUMS`; the desktop
    image is live on GHCR (`ghcr.io/sanlega/openbot-desktop:latest` + `:v0.1.0`). Getting
    here took three real release-pipeline fixes, found only by actually running it (see
    LESSONS.md): the Docker build's hand-picked `--filter` list missed devDependency-only
    packages (fixed with pnpm's recursive filter), electron-builder's `.deb` target
    needed `homepage`/`maintainer` and a non-scoped `artifactName`, and `publish`'s
    `download-artifact` step grabbed every workflow artifact including an unrelated
    `docker/build-push-action` provenance zip that transiently failed and blocked the
    release even though all 4 real installers had already built fine (fixed with a
    `pattern: "openbot-*"` filter). D-020's visibility risk did not materialize: the
    GHCR package inherited public visibility from the repo automatically (confirmed
    both via the API — `visibility: "public"` — and a real anonymous `docker pull`
    after `docker logout ghcr.io`, which succeeded). No manual visibility flip was
    needed.
- **RESOLVED (2026-09-28) — old ref exposure**: the previous `sanlega/OpenBot`
  repo's history-cleanup left `refs/pull/1..18/head` pointing at pre-rewrite commits
  (personal email, local machine paths, a private metaharness URL, a private Claude
  session URL, identifying sample names). GitHub confirmed those hidden refs can't be
  deleted by the owner (`deny updating a hidden ref`) — only Support can purge them.
  A Support ticket for that purge was submitted 2026-09-28 (confirmed sent) but is
  slow/uncertain, so instead: that repo was renamed to `sanlega/OpenBot-old` and set
  **private** (verified with an unauthenticated `curl` → `401`, not just `gh`/stored
  credentials), and a brand-new `sanlega/OpenBot` was created public with `main`
  (already-clean history) pushed as its only branch/history. A fresh repo has no PRs
  ever opened against it, so it has zero `refs/pull/*` and can never inherit this
  exposure — this is the permanent fix, the Support ticket is now a nice-to-have for
  `OpenBot-old` (which stays private regardless). Local `origin` now points at the new
  repo. Cost of the move: negligible — the old repo was 2 days old, 0 issues, 0
  releases, 0 forks, 1 star; all 18 PR *branches* were already merged/closed into
  `main` before the move, only PR *discussion metadata* was left behind (not code).
  README/CI-badge links needed no changes since owner+name are identical.
  Still open: first CI run on the new repo was `queued` right after the push — check
  `gh run list -R sanlega/OpenBot` for whether the account-level GitHub Actions
  billing block (see below) still applies there, since that's separate from this fix.
- **DONE (2026-09-28)** — Settings action to get/reset the Computer desktop image
  (Docker), so users don't need a terminal. Plan (all 10 tasks checked off):
  `.ai/memory/plans/2026-09-28-computer-image-settings.md` (D-020: the image ships via
  GHCR, `ghcr.io/sanlega/openbot-desktop`; local `docker build` stays a dev-checkout
  convenience only, auto-detected via `findLocalDockerfile()`). Shipped: `ComputerImageManager`
  (`packages/computer/docker/src/image-manager.ts`) with get/reset/refresh + a
  `computer.image_status` event on every transition; three new core routes
  (`GET/POST /api/computer/image`, `POST /api/computer/image/reset`); `POST
  /api/computer/start` now replies `409 image_missing` instead of a raw error when the
  image isn't ready; a Settings > Computer card with live WS-driven status and an
  inline-confirm Reset; the bot Computer tab points to Settings on that same 409. CI
  gained a `publish-desktop-image` job on `.github/workflows/release.yml` (validated
  with `js-yaml` — the initial version had a real YAML syntax error from an unquoted
  colon in a step name, caught before commit). Full verification: build, typecheck,
  831 tests passed (0 failed, 18 pre-existing skips), lint (same 3 pre-existing
  warnings, 0 new), format, `mh check` — all clean. Still open: the GHCR-visibility
  risk from the plan (package inheriting private/public from the repo) — verify actual
  package visibility after the *first real* CI publish (a `v*` tag push), since this
  session never ran that workflow for real.
- Prepare the first downloadable GitHub release (`v0.1.0`) and polish the public repository.
  Plan: `.ai/memory/plans/2026-09-27-github-release.md`. Note: this plan predates the
  repo migration above — re-check its PR #18 references against the new repo (which has
  no PR history at all; `main` already has everything PR #18 would have brought).
- The user approved history cleanup. All 18 branch heads on the old repo were rewritten;
  old local session notes, machine paths, a personal email, a private metaharness URL,
  a private Claude session URL, and identifying sample names were scrubbed. Superseded
  by the repo migration above for the exposure this left behind.
- A protected local history backup exists outside the repository. Its location and
  recovery notes are in ignored `.ai/local/history-cleanup.md`.
- Credential-pattern scan found no real credentials. One synthetic credential-shaped
  match remains in the deliberately fake 401 fixture; this scan is not exhaustive.

## Repo cleanup (Claude, 2026-09-28)
- Remote now has only `main` and `claude/product-polish`. The 15 `cursor/*` branches
  (all ancestors of `main`) were deleted locally and on GitHub. The old PR #16 branch
  `claude/openbot-dev-review-vi6h4j` was deleted too: its README rewrite (architecture
  diagrams) now lives, Composio-free, in `docs/architecture.md` (linked from README).
  Its original commits survive only in the local tag `archive/openbot-dev-review`.
- `apps/pwa/static/` is a build output (regenerated by `build-static.mjs`) and is no
  longer tracked; the dead vanilla UI in `apps/pwa/src/static/{app.js,index.html}` was
  removed. Checks: build, typecheck, lint (0 errors), format, 777 unit tests pass.
- 2026-09-28: `main` fast-forwarded to `claude/product-polish` (8cfc645) with the
  owner's OK; PR #18 shows merged. GitHub CI has never run: every job is refused
  with "recent account payments have failed or your spending limit needs to be
  increased" (Billing & plans). Code passes the full pipeline locally on macOS;
  Windows/Linux untested until billing is fixed.

## Design audit round 2 (2026-09-28)
- Audit (30 items) fixed so far: P0 lost-message-while-reconnecting, markdown
  tables breaking words, Activity overflow on phone; P1 held-message naming
  ("Held for digest"), engine icons, wizard "get a key" link, aria-current +
  live region, bot-row focus ring, approval command wrapping + chevron, code
  block language + Copy, connector host copy, routine first-run cause.
- Also done: Audit titles/labels, empty-name validation, model-select copy,
  wizard copy/dots, palette focus, live-view placeholder, connect dialog tool
  summary, locale times, turns stored as running + "Waiting for you" in Audit.
- Round 3 (all remaining audit items done): search-first community tab with
  readable publishers; "coming soon" connectors sorted last; Settings > Spending
  lists today's spend per bot vs its limit; a turn says when its computer task
  still needs text; "You:" in sidebar previews; reconnect toast floats.
- Permissions: the Full preset no longer asks (built-in denies/asks and steps
  Jev is sure are major and irreversible still do). Interrupted turns show why.
- Never reinstall the app while a turn runs (it interrupts the turn): check
  events for a `turn.started` without a terminal event first.
- Open: letter logos on connectors (needs licensed SVG marks); merge to main
  and deleting 18 old app backups (6.4 GB) await the owner.
- Bot avatars are blobatars (`@blobatar/react`), expression = status.
- README rewritten with 10 screenshots from `scripts/readme-screenshots.mjs`.

## Computer loop v2 (2026-09-28, verified live)
- Jev answers one `action` choice among described candidates
  (`packages/computer/src/candidates.ts`: goal-matching elements first, ≤24,
  plus enter/escape/scroll/wait/done/blocked); reversible steps may run on a
  clear lead; unsure → reason lists top options for the engine. Cookie notices
  are closed without Jev. Jev computer timeout 3 s with retries (was 400 ms, no
  retry → "Jev is unavailable"). Live YouTube search+open-first-result: 3/3.
- Research and remaining recommendations (engine-planned sub-steps, engine
  fallback when unsure, per-action thresholds, persisted decision log):
  `.ai/resources/2026-09-28-computer-control-research.md`.
- Gap: the decision log is in memory only (`decisions` table stays empty).

## Jev + computer control fixes (2026-09-28, verified live)
- Setup never saved the TypeSafe key (route only probed it); fixed, and a stale
  "ok" without a key is reset at startup. Owner re-entered the key; Jev works.
- Docker computer: `type` now focuses its field; clicks/typing go through CDP
  in page coordinates (xdotool screen coords landed in the toolbar); navigate
  reuses the tab and closes strays; the DOM reader lists visible elements with
  an open dialog's controls first (cookie consent). Live: YouTube consent →
  search → results → first result = youtube.com/@sanlega.
- The `openbot/desktop` image must be rebuilt after changing
  `packages/computer/docker` (the daemon runs inside it). Rollback:
  `openbot/desktop:previous` image and stopped `openbot-desktop-previous`.

## Design audit P0 (done 2026-09-28, on the branch)
- Approval card reuses `activity/format.ts` (no raw bot ids; "Run a command"; risk
  as low/medium/high). Phone composer: min-height and 16px text (no iOS zoom).
- Computer tab: one Screen card (16:10 live view, Take over in the header, quiet
  shared-workspace note); legacy `.computer-grid`/`primary` markup removed.
- Routines: single pane with back link under 960px; narrower list up to 1100px;
  action rows wrap. E2E 18/18 pass. Remaining audit items are P1/P2 (header
  alignment, auto-save, connectors polish, profile selects, new-bot dialog,
  palette ranking, keyboard nav, wizard, hard-coded colors).

## Latest (Claude, after reviewing Codex's work)
- CI blocker found and fixed locally: the history cleanup replaced the
  outside-workspace path in two approval E2Es with a relative placeholder, which
  the tool classifier correctly treats as an in-workspace write (no card). Tests
  now use a neutral absolute path. Research notes were Prettier-formatted (they
  failed `format:check`). Local: lint, format, build, typecheck, 735 unit tests
  (UI component tests now run from the root Vitest projects), E2E 15/15.
- Desktop: min window size, macOS hidden-inset title bar with draggable headers,
  app menu (Settings Cmd+,), notification clicks navigate the UI.
- Harness serves PWA icons and hashed assets per request (no restart after a UI
  rebuild). Stored theme applies before first paint.
- Design system: `docs/design-system.md` + live gallery at `/app/?design`.
- Connectors: plan `.ai/memory/plans/2026-09-28-connectors.md`, decision D-019
  (open MCP only, Composio removed). UI done: Connectors screen (gallery,
  community, connected, connect dialog) and per-bot toggles in the profile.
  Backend T1–T3 (remove Composio, curated catalogue + routes, per-bot MCP
  injection) is committed on the branch. Plan T4 UI is also implemented; review its
  acceptance checklist before marking complete. OAuth and custom connectors remain later
  slices in that plan.
- Also done: command palette (bots, screens, actions), "Waiting for your
  approval" turn state. Claude Models API discovery is wired into `/api/models`
  for API-key mode. CLI-login bots retain bundled aliases because Claude Code
  exposes no documented model-list endpoint for subscription OAuth.
- Owner approved (2026-09-28): (1) pushing the branch — done, PR #18 head now
  includes the CI fix; CI result not visible from this shell (no `gh`); (2) a LAN
  mode for phone pairing. Design: owner toggle "Allow phones on this Wi-Fi" in
  Devices (off by default) → bind 0.0.0.0 on next start (desktop restarts the
  harness), pairing QR lists private-range LAN IPv4s; non-loopback requests still
  need a paired device token and pairing still needs the QR secret. Starts after
  the connectors backend work lands (same packages).
- Current local changes are committed and pushed to `claude/product-polish`.

## Jev computer control (owner priority, 2026-09-28)
- Implemented and pushed: background computer tasks the engine can follow,
  steer, supply text to, and cancel (MCP `computer_task/status/steer/cancel`);
  Jev picks click/type/select/scroll/key/wait/done/blocked from DOM/AX/OCR
  observations; OpenBot validates targets, runs broker checks, and risky steps
  wait on a real approval card; Jev unavailable → stop with a clear reason.
  UI: bot profile → Computer shows a live step timeline, pending text, Stop.
- Next: live test with a real Jev key + Docker desktop (tune question wording,
  measure latency, check Spanish pages), then consider streaming step events
  into the chat's turn steps.

## Message sending / desktop diagnosis (2026-09-28)
- The Chief's `o4-mini` turn stayed open after `turn.started`; OpenBot later restarted
  and marked it `turn.interrupted` with "OpenBot restarted before this turn finished."
  A subsequent Claude turn failed immediately with the Claude session-limit message.
  There was no active turn left that continued to hold the composer.
- Root cause of the long-running o4 attempt: the installed `OpenBot.app` was built at
  00:25, before commit `aa028d1` at 00:34 fixed recursive `initialize` waiting in Codex
  app-server startup. The current source has a regression test for initialize + `model/list`.
- Rebuilt and installed the current app after backing up the previous bundle under
  `~/openbot-backups/`. The new app's `/api/models` returns in 36 ms with seven Codex
  models. `/api/computer/tasks` responds; the current task list is empty. The user's
  Application Support data was not modified.
- The Codex account's current catalog does not include `o4-mini`; the Chief is now set to
  Auto. The earlier UI allowed selecting `o4-mini` from the old bundled list. After the
  startup fix, pin one of the seven current Codex catalog IDs if a fixed model is wanted.
- Jev task timeline and steer/stop controls live inside each bot's Computer tab. That tab
  is shown only for Bots with computer access. No real task was launched during diagnosis.

## Product status
- OpenBot is an early desktop preview for managing persistent Claude Code and Codex Bots.
- The app includes chat, team delegation, approvals, routines, local computer use, a PWA,
  and optional remote pairing.
- Users supply their own provider accounts and keys. OpenBot has no hosted backend and
  ships no bundled credentials.
- Computer Live View uses a Docker-backed virtual desktop; local-computer mode is
  available with explicit permissions.
- The README includes screenshots generated with mock data.

## Recent change
- Chat now retains an engine failure reason and shows it beside the latest failed turn,
  including failures that happen before any tool step. The chat error view redacts common
  bearer and API-key formats. The PWA static assets are rebuilt and served locally.
- Research found Jev is a typed decision API, not a computer-using agent: OpenBot must
  execute Jev's bounded decisions through the existing Computer SPI and permission broker.
  The Codex app-server exposes `model/list`; the current authenticated account catalog
  returns seven visible models. Anthropic does not
  document subscription-session model enumeration for Claude Code; its Models API is
  available to API-key mode. Full sourced findings: `reports/Control Jev y modelos disponibles.md`.
- Codex model discovery is partially implemented locally: the authenticated app-server
  now calls paginated `model/list`, maps model IDs/labels, and falls back to the bundled
  catalog if discovery fails or is unsupported. Focused tests and package typecheck pass.
- Active implementation/research plan: `.ai/memory/plans/2026-09-27-jev-computer-and-models.md`.

## Validation on the product-polish branch
- UI test suite, UI typecheck, build, formatting, and lint passed after the latest UI fix.
- The local `/app` route serves the rebuilt bundle. GitHub Actions runs 62 and 63 failed in
  all jobs and the connector could not fetch logs. Recheck CI after the rewritten PR head
  and obtain logs before diagnosing; do not merge until required checks pass.
- After repository polish: 733 tests passed (18 skipped), build and typecheck passed,
  format and `mh check` passed. Lint has three pre-existing warnings and no errors.

## Known gaps
- Real Claude/Codex and Jev credentials, Docker on other operating systems, and
  remote-provider integrations need broader manual testing.
- A real-key Jev + Docker live-use test remains. GitHub CI run history below this point
  predates the 2026-09-28 repo migration (see "In progress" above) — re-check CI on the
  new `sanlega/OpenBot` rather than assuming old run numbers still apply.
- The GitHub Support purge for `OpenBot-old`'s closed PR refs and cached views remains
  outstanding, but is no longer a repository-visibility blocker: the current
  `sanlega/OpenBot` is a fresh repo with no PR history at all (see "In progress" above),
  and `OpenBot-old` stays private regardless of whether Support ever purges it.
- Desktop packages are unsigned and will show operating-system warnings.
- Follow-up work includes code signing/notarization and deeper end-to-end coverage for
  routine editing and remote pairing.
