# v0.1.0 published; spawn-gate + routine-budget fixes; permissions/memory redesign queued

- **Fecha**: 2026-09-29 01:09
- **Agente**: claude
- **Rama**: main @ a6310ee

## Summary

Two sessions of live testing on the packaged Windows app against the just-published
v0.1.0, each surfacing real bugs fixed the same session (not hypothetical — every fix
traced to an actual observed failure in `~/.openbot/openbot.db`/event logs).

### Round 1 (led to v0.1.0 actually publishing)
- Windows-specific build/setup lessons (electron-builder symlinks needing an elevated
  terminal, a stale rolldown optional dependency, better-sqlite3 segfaulting on Node
  22.11 — fixed by upgrading to 22.12+).
- The `packages/computer/docker` image is now distributed via GHCR (D-020) instead of
  requiring a local `docker build`; Settings > Computer has a UI to get/reset it.
- Migrated off the original `sanlega/OpenBot` repo (D-021) after discovering its
  history-cleanup left `refs/pull/*/head` still pointing at pre-rewrite commits with
  personal data, unpurgeable by the owner (needs GitHub Support, ticket filed but
  superseded — the new repo has no PR history at all, so the exposure can't recur).
- Found and fixed three release-pipeline bugs (Docker build filter, `.deb` metadata,
  a GH Actions artifact-download filter) purely by actually running the pipeline.
- v0.1.0 is live: https://github.com/sanlega/OpenBot/releases/tag/v0.1.0, GHCR image
  confirmed publicly pullable with no auth.

### Round 2 (Chief of Staff stress-testing)
- Fixed a mailbox bug where a turn completing with no text (Codex ending on a tool
  call) produced total silence instead of a message.
- Fixed engine-routing context loss on follow-ups (D-022): Jev now gets told which
  engine is already active and how idle it's been, weighted against switching.
- Fixed a spawn-gate near-miss: a 0.97-confidence "create a new bot" answer was denied
  over one secondary signal missing its threshold by 0.02. Very-confident answers now
  tolerate more doubt in that one signal.
- Added an opt-in per-bot switch (`Bot.limits.unrestrictedRoutineBudget`, off by
  default) so a routine's own cost/token cap doesn't interrupt real progress.
- Found a vitest footgun: `pnpm --filter <pkg> test` can run stale compiled
  `dist/*.test.js`; root `pnpm test` is unaffected and is the authoritative check.

### Not done yet — natural next steps
1. Live-retest "continua" after the D-022 fix to confirm Jev actually stays on the
   same engine now (needs a real Jev key + real engines, can't be faked).
2. The owner wants to design **per-bot permission modes** beyond today's three fixed
   presets, specifically: a delegated bot inheriting permissions the delegating bot
   already has, and more generally shared/inherited memory between bots. Not designed
   yet — this is a real architecture decision (plan-feature territory), not a quick
   patch. Start here if the owner returns to this thread.
3. Two smaller open threads from the owner: whether the Computer/Jev fast loop gives
   up too fast on ambiguous dialogs (one real case: X/Twitter signup's login-vs-signup
   modal), and researching Firecracker microVMs as a stronger per-bot isolation
   alternative to today's shared Docker desktop container.
4. A prior open item (still unpicked-up): the bot wrote a report inside its own
   workspace instead of `~/Desktop/...` "outside the workspace" as asked, in the very
   first stress test. Root cause not investigated (possibly `~` not expanding before
   the tool-classifier sees the path).

## Retro

What worked: reading the actual running app's state (SQLite `decisions`/`turns`
tables, the NDJSON event log, files on disk) instead of guessing from screenshots
turned "it's broken" into two precise, cheaply-fixed bugs with exact numbers. Local
Docker builds + a real container health check caught the release-pipeline Docker bug
before a second failed CI round-trip.

What to improve: I should have asked once, up front, whether "test with Docker/real
engines" meant the owner already had those live-tested locally, before assuming a
pure code review would be enough — several of this session's real bugs only exist
under real engine/Jev/Docker conditions that unit tests with fakes structurally can't
reach. Also hit the per-package `pnpm --filter test` dist-staleness trap mid-session
myself; now documented, but worth remembering to prefer root `pnpm test` when a result
looks surprising.
