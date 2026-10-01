# Plan: the Grok Bot box roadmap (robust box, agents that don't get stuck, memory)

_Source: the owner's design document "Hoja de ruta de OpenBot" (2026-10-01), built from a
snapshot of Grok Bot's VM internals. Ids (A1..D3) follow that document._

## Goal
Bring OpenBot's runtime behaviour as close as possible to Grok Bot's: every process supervised,
every risky action classified, every loop detected, persistent memory, and a box that bots
cannot use to steal the daemon token or other bots' sessions.

## Acceptance criteria
- A bot's `vm_shell` runs as an unprivileged user (`box`, uid 1000) with no capabilities; it
  cannot read the daemon's token, `/data/browser`, nor reach the daemon, CDP, VNC or X sockets.
- A dead Chromium / x11vnc / fluxbox / Xvfb on a screen comes back by itself (backoff,
  crashloop window, down reason from its log tail) and the browser gets the sign-ins again.
- `/health` reports per-screen component state; `/doctor` runs the box self-checks and Settings
  > Computer shows them.
- Cookie jar keys include `partitionKey`, skips Google's rotating cookies, validates prefixes and
  falls back to one-by-one on a rejected batch.
- A turn with no engine event for N minutes is interrupted, resumed once, then fails with
  `engine_stalled`.
- Repeating the same OpenBot tool call with the same (normalised) result is detected and the
  result carries a loop reminder; native tools are recorded in shadow.
- Bots remember facts across sessions (`remember`/`forget`/`recall`), injected into the prompt
  with a budget, visible and deletable in the UI.
- Full unit suite, lint, typecheck, format, E2E and `mh check` green; box changes verified live
  with `scripts/live/vm.mjs`.

## Tasks (phase order; mark as done)
Phase 1 — a box that doesn't break
- [x] A2 tini as PID 1 (`Init: true` + image ENTRYPOINT), RestartPolicy on-failure
- [x] A3 `box` user, CapDrop ALL + minimal CapAdd, no-new-privileges, memory/pids/shm limits,
      `chown -h` of `/data/home`; Chromium keeps `/dev/shm`
- [x] A4 commands as `box` (uid separation hides `/proc/<daemon>/environ` and `/data/browser`),
      loopback firewall for `box` (daemon, CDP, VNC, noVNC), X sockets root-only, root-only apt
      helper socket so `apt-get install` still works
- [x] A5 `nice` for commands, `oom_score_adj` (commands 500, Chromium 300), process cap
      (no `ionice`, no cgroups; negative scores need CAP_SYS_RESOURCE, which is dropped)
- [x] A8 persistent machine-id and owner time zone
- [x] A1 + B3 + A6 + A9 desktop supervisor: restart with backoff, crashloop window, ring-log
      tail, down reason, single Chromium launcher, RFB check, state in `/health`, telemetry
      ndjson + `/telemetry`
- [x] B1 cookie jar: partitionKey, rotating cookies, prefix validation, per-cookie fallback
- [x] B4 per-screen lease tokens for `/act` and `/observe`
- [x] A7 `/doctor` + Settings > Computer card
Phase 2 — agents that don't get stuck
- [x] C8 per-turn inactivity watchdog with one resume
- [x] C1 tool-loop detector (OpenBot tools: on; native: shadow), logged as decisions
- [x] C3 executor send rules for delegated workers
- [x] C2 anti-detour denial text (Claude's permission prompt); no duplicate pending cards;
      narrow "Always allow" rules. Not done: "interrupted is not denied" wording, Codex/ACP
      refusal text
- [x] C4 harness reminders (previous turn interrupted/failed, open cards and forms, steered
      message). Not done: "MCP still loading"
- [x] C7 spill large `browser_read` results to a file
- [x] C10 latency columns on turns (migration)
- [x] C6 stable tool order/description
- [x] B7 anti-bot wall families in the fast loop
Phase 3 — memory and updates
- [x] C5 scoped memory (table + tools + prompt injection + UI)
- [x] D2 defer box recreation while work runs
- [x] D3 classified crash markers
Also done: B2 localStorage replication, C9 playbooks, per-turn usage storage.
Later / not in this pass: D1 hot daemon update, B5 CDP proxy, B6 UA/Web Bot Auth, C11 eval
runner.

## Risks
- Docker Desktop kernels without iptables owner match: the firewall step must degrade to a
  doctor FAIL, never block start-up.
- Existing volumes have root-owned `/data/home`: entrypoint migrates with `chown -hR`.
- Bind-mounted workspace is the owner's folder: never chown it.

## Outcome (2026-10-01)
Done and verified (D-034): the phase 1-3 tasks above (with the noted gaps), plus B2, C9, narrow
"Always allow" rules, per-turn usage (it was never stored) and a pre-existing bug found live (a
page with one control fell back to the AX tree, whose clicks silently pressed Return). Live:
`scripts/live/box.mjs` 15/15, `vm.mjs` 11/11 (local image), `scripts/live/memory.mjs` 7/7 with
real Claude and real Codex. Pipeline: build, typecheck, 1316 unit tests, 23 E2E, lint 0
errors, format, `mh check`.

Adapted rather than copied: per-command bubblewrap/Landlock became user separation plus a
loopback firewall (Docker blocks user namespaces); cgroups became nice, OOM score and a process
cap; Grok Bot's 1.5 s session-sync loop became a sync when a bot looks at its screen.

Next candidates, in order: release (republish the image: users only get the hardened box with
a `v*` tag); D1 hot daemon update with rollback (useful only once images stop being republished
per release, an owner decision); C11 eval runner on the real harness; B5 CDP proxy so
connectors can use the VM browser; turning the native-tool loop detector from shadow to on after
a week of `tool_loop` decisions; a UI for the latency and cache numbers in /api/usage.
