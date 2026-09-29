# Autonomy issues #1-#6 fixed, image tested, independently reviewed

- **Fecha**: 2026-09-29 18:03
- **Agente**: claude
- **Rama**: main @ 95cdc5f

Fixed the six autonomy issues (#1-#6), built and tested the desktop image locally, and had an independent agent review it twice.

## Done
- #6 turn failures explained + Codex thread resume; #2 Full really means no cards; #3 VM-only Bots denied host browsers; #4 Docker Desktop auto-start + daemon hardening; #1 Chief delegates by default; #5 saved logins typed by the host in the VM.
- Live: image built and run, real VM login with real Jev, docker kill recovery, Docker Desktop auto-start, real Claude under Full vs workspace_write, real Chief created a bot and delegated.
- Review: FAIL then PASS WITH FINDINGS; all high/medium findings fixed. 973 unit tests, 18 E2E. Issues #1-#6 closed, #7 updated, #8 open.

## Next
- Release (needs owner OK) and republish the desktop image to GHCR; install and try in the real app.
- #8 engine shell inside the VM; approval-card secret hiding for unrelated field labels.

## Retro
- Worked: task list per issue, live checks with real Jev/VM, an adversarial verifier with a concrete brief found what I missed.
- Failed: python heredoc edits with backslashes were silently altered by the tool layer (regexes lost \b); use the Edit tool or chr(92) for regexes.
- Improve: design secrets as a first-class boundary from the start (mask at source, fixed namespaces) instead of adding it after review.
