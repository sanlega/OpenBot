# D-037 decision providers: released v0.1.21 and installed

- **Fecha**: 2026-10-02 19:03
- **Agente**: claude
- **Rama**: main-2 @ 8f70848

## Done
- Fixed the last E2E check (two-question server check text), 26/26 E2E.
- Released v0.1.21: CI green on all three OSes, release workflow green (5 installers, SHA256SUMS, GHCR `:v0.1.21`), Windows installer hash verified, installed silently with no turns or tasks open.
- Installed app: reports 0.1.21, migration 0008 applied, VM on `:v0.1.21` with `/screenshot`, self-check 10/10. `/api/decisions/check` on the installed app against real Laya (fails yes/no, as known) and ImaJev (passes); no key returns 401. Owner settings untouched.
- Plan ticked with an outcome, lessons added, local model servers stopped, the temporary home copy deleted.

## Next
- The owner tries Settings > Jev > Decision model. Laya's current model fails yes/no probes, so Hybrid with Laya shows the warning; the owner decides whether to use it.

## Retro
- Worked: measuring vision bands on real screenshots before setting thresholds; the two-question probe caught a real Laya weakness.
- Failed: a heredoc with `</dev/null` on the same command loses the heredoc (stdin is replaced), so the changelog silently wasn't written. Use Edit or a temporary file for content.
- Improve: the installed-app UI check needs the owner key in a browser URL. A desktop-window computer-control path (not Chrome) would let an agent click through the installed app without handling the key.
