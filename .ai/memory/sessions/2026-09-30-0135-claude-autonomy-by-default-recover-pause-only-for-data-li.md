# Autonomy by default: recover, pause only for data, live-verified

- **Fecha**: 2026-09-30 01:35
- **Agente**: claude
- **Rama**: main @ c38916a

## Done
- D-030 autonomy work on main (commits 6295b60, 2d26fa1, c38916a + memory): recovering Jev loop,
  pausable blockers (needs_user) that resume on their own, resumable tasks, one task per Bot,
  cards only for paying/deleting controls, shared AUTONOMY_PROTOCOL, `next` hints, VM-only Bots
  never get host-browser connectors/tools.
- Live harness moved to `scripts/live/` (site + driver, README). Six scenarios passed with real
  Chief/Jev/Docker on copies of the real home.
- Verification: 1139 unit, 23 E2E, lint 0 errors, format, typecheck.

## Pending
- Release (owner's OK) and replay scripts/live against the installed app.
- Real third-party sites (bot defences) untested.
- Chief tends to do short browser jobs itself; delegates when asked.

## Retro
- Worked: a local fake site + a driver that checks the site's own state; it found three real bugs
  (credential fields asked the engine for text, host Chrome via Playwright connector, deletion goal
  made every step ask) that unit tests did not.
- Failed: a second Claude session edited the same tree in parallel; coordination by message only
  half worked (peer unreachable). Bash heredocs mangled regexes (\b -> \x08).
- Improve: the harness should warn when two sessions run on one working tree.
