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
- [ ] A2 tini as PID 1 (`Init: true` + image ENTRYPOINT), RestartPolicy on-failure
- [ ] A3 `box` user, CapDrop ALL + minimal CapAdd, no-new-privileges, memory/pids/shm limits,
      `chown -h` of `/data/home`; Chromium keeps `/dev/shm`
- [ ] A4 commands as `box` (uid separation hides `/proc/<daemon>/environ` and `/data/browser`),
      loopback firewall for `box` (daemon, CDP, VNC, noVNC), X sockets root-only, root-only apt
      helper socket so `apt-get install` still works
- [ ] A5 `nice`/`ionice` for commands, `oom_score_adj` per component
- [ ] A8 persistent machine-id and owner time zone
- [ ] A1 + B3 + A6 + A9 desktop supervisor: restart with backoff, crashloop window, ring-log
      tail, down reason, single Chromium launcher, RFB check, state in `/health`, telemetry
      ndjson + `/telemetry`
- [ ] B1 cookie jar: partitionKey, rotating cookies, prefix validation, per-cookie fallback
- [ ] B4 per-screen lease tokens for `/act` and `/observe`
- [ ] A7 `/doctor` + Settings > Computer card
Phase 2 — agents that don't get stuck
- [ ] C8 per-turn inactivity watchdog with one resume
- [ ] C1 tool-loop detector (OpenBot tools: on; native: shadow), logged as decisions
- [ ] C3 executor send rules for delegated workers
- [ ] C2 anti-detour denial text; interrupted ≠ denied; no duplicate pending cards
- [ ] C4 harness reminders (interrupt, MCP loading)
- [ ] C7 spill large `browser_read` results to a file
- [ ] C10 latency columns on turns (migration)
- [ ] C6 stable tool order/description
- [ ] B7 anti-bot wall families in the fast loop
Phase 3 — memory and updates
- [ ] C5 scoped memory (table + tools + prompt injection + UI)
- [ ] D2 defer box recreation while work runs
- [ ] D3 classified crash markers
Later / not in this pass: D1 hot daemon update, B2 localStorage replication, B5 CDP proxy,
B6 UA/Web Bot Auth, C9 playbooks, C11 eval runner, C2 proposed allow rules.

## Risks
- Docker Desktop kernels without iptables owner match: the firewall step must degrade to a
  doctor FAIL, never block start-up.
- Existing volumes have root-owned `/data/home`: entrypoint migrates with `chown -hR`.
- Bind-mounted workspace is the owner's folder: never chown it.

## Outcome
_(fill in at the end)_
