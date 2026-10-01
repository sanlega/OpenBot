# Backlog sweep after v0.1.18: all items, D-036 local owner key, reviewers 10/10

- **Fecha**: 2026-10-01 18:42
- **Agente**: claude
- **Rama**: main-2 @ ff3ab0a

## Done
- Every item of `.ai/memory/plans/2026-10-01-backlog-sweep.md`, implemented and tested on `main-2` (pushed, not merged, not released):
  - K1-K4, L1-L3, M1-M3 and N1-N3;
  - P1 (Check again in Settings > Engines) and P2 (the Chief's greeting, which its first turn knows about);
  - R1 (unpaired screen), R2 (already true) and R3 (reconnect E2E);
  - Q1 (`pnpm eval`), Q2 (release signing when the secrets exist) and Q3 (Firecracker note).
- D-036, from the functional reviewer: a per-install local owner key, loopback Host plus no proxy headers, an Origin guard, owner-only engine routes, and built-in denies for the harness port and the key file.
- Design pass: `friendlyError`, AA contrast tokens and `formatDate`, plus Memory, Health, Tasks, Files, Speed and dialog UX.
- Checks: 1392 unit tests, 26 browser E2E, the Electron smoke test, and `openbot eval` both fake and `--real` (including the VM case). Lint has 0 errors.

## Next
- The owner decides on merging to `main` and releasing v0.1.19.
- The release notes must say that the browser UI needs the `#key=` link from `openbot serve`, and that remote browsers need pairing.
- After installing, replay `scripts/live`.

## Retro
- What worked: two independent reviewer agents, each re-asked after every fix round. The functional reviewer found real security holes: Tailscale and tunnels counted as the owner, DNS rebinding, and a shared Codex app-server killed by re-detection.
- What failed: patch scripts with escapes in heredocs, many times. Use Edit for anything with backslashes or regexes. Stray stdin readers hung the shell twice.
- What I'd improve in the harness: an `mh` helper that applies exact-match patches from a JSON file, to avoid shell escaping.
