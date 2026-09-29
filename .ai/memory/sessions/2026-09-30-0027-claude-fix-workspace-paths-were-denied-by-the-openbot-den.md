# Fix: workspace paths were denied by the .openbot deny regex

- **Fecha**: 2026-09-30 00:27
- **Agente**: claude
- **Rama**: main @ 511d09e

Found from the owner's real logs why every Bot command and patch was rejected instantly in v0.1.11: the .openbot deny regex backtracked on JSON-doubled Windows paths and denied the Bot's own workspace. Fixed with regression tests; replayed on a copy of the real data (shell, apply_patch, local server, URL returned).

## Retro
- Worked: reading events showed tool.started and tool.completed in the same millisecond with no approval and no Jev decision, which pointed at a built-in deny; replaying the real event payloads and a regex diff nailed it.
- Failed: I called the pipeline verified after live tests that all ran in a temp home without a .openbot folder in the path; the owner's real layout broke it.
- Improve: keep a script in the repo that replays a scenario on a copy of the real home (scripts/live-real.mjs idea) and run it before every release.
