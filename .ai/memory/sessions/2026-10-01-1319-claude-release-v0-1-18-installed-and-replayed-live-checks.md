# Release v0.1.18: installed and replayed live checks

- **Fecha**: 2026-10-01 13:19
- **Agente**: claude
- **Rama**: main-2 @ 5e24003

## Summary
Released and installed v0.1.18 (Grok Bot roadmap D-034 + B5 D-035).

## Done
- main-2 fast-forwarded into main; CI green on macOS/Windows/Linux incl. desktop E2E.
- Tag v0.1.18; release workflow green; Windows installer SHA-256 verified; silent install with no running turn/task; app reports 0.1.18; migrations 0004/0005 applied; VM replaced by :v0.1.18 (self-check 10/10).
- Live on the released image: box 19/19, vm 11/11, memory 7/7 (Claude, Codex), vmconnector 4/4 (Claude, Codex), vmbot 11/11 (Claude, Codex).

## Next
Owner tries it for real; backlog D1, B6, C11.

## Retro
- Worked: waiting for main's CI (it ran the desktop E2E not run locally) before tagging; checking the live DB read-only for running turns before reinstalling.
- Watch: Docker Desktop's clock made 'Up less than a second' look like a restart; docker events settled it.
