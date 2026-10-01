# Grok Bot roadmap: hardened supervised box, agents that don't get stuck, memory

- **Fecha**: 2026-10-01 12:20
- **Agente**: claude
- **Rama**: main-2 @ a99e3fd

## Summary
Implemented the owner's "Hoja de ruta de OpenBot" (Grok Bot's VM internals) on branch `main-2`:
D-034, plan `.ai/memory/plans/2026-10-01-grok-bot-box-roadmap.md` (all tasks ticked, gaps noted).

## Done
- Box: tini, `box` user for bots' commands (no capabilities, niced, OOM-first, process cap),
  CapDrop ALL + minimal CapAdd, no-new-privileges, memory/pids/shm limits, loopback firewall,
  root-only X sockets, apt through a root-only helper, machine-id + time zone, label-based
  replacement of old containers, replacement deferred while the box is busy (D2).
- Supervisor per screen (backoff, crashloop, down reason, RFB and DevTools probes), `/health`,
  `/doctor` (11 checks) + Settings > Computer > Health, `/telemetry`, `/logs`, screen leases.
- Cookie jar fixes; localStorage shared per origin.
- Runtime: stall watch, tool-loop detector, reminders, anti-detour refusals, joined duplicate
  cards, delegated send rules, narrow "Always allow".
- Memory (C5) end to end; per-turn usage + latency (migrations 0004, 0005); anti-bot walls;
  site playbooks; crash markers.
- Bug found live and fixed: single-control pages fell back to AX elements without positions,
  clicks pressed Return and reported ok.

## Verification
build, typecheck, 1316 unit tests, 23 E2E, lint 0 errors, format, mh check. Live:
`scripts/live/box.mjs` 15/15, `vm.mjs` 11/11 (local image `openbot-desktop:dev`),
`scripts/live/memory.mjs` 7/7 Claude and 7/7 Codex on a copy of the owner's home.

## Next
Owner review → merge `main-2` into `main` → release (image republish) → replay live checks on
the installed app. Then D1, C11, B5 (plan outcome lists the order).

## Retro
- Worked: building the image locally and writing a live script per claim (`box.mjs`) caught two
  wrong assumptions of my own checks (example.com changed its text; a pgrep that matched itself)
  and one real product bug (AX fallback clicks).
- Failed: patching code with `node -e` from Bash broke three times (quotes, regex slashes,
  template literals) — the existing lesson already said so; I should have used Edit/Write from
  the start. A chained `&&` aborted silently and a test file was never written until I noticed.
- Harness improvement: a tiny `mh` helper (or skill note) to apply multi-line replacements from
  a file would remove the temptation of inline scripts.
