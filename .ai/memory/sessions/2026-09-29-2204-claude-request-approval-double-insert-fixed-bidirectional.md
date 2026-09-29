# request_approval double insert fixed; bidirectional delegation design drafted

- **Fecha**: 2026-09-29 22:04
- **Agente**: claude
- **Rama**: main @ b7066e0

Fixed request_approval double-insert (UNIQUE approvals.id) with a regression test; diagnosed the one-way delegation pipeline and wrote the bidirectional design plan. Implementation waits for the research report.

## Retro
- Worked: reading the real events/approvals rows found the duplicate insert quickly; testing the broker against the real commands ruled out a deny.
- Failed: a git stash dance briefly reverted my own fix; the first test assertion used the wrong result shape.
- Improve: unit tests use the in-memory approval store, which hid the repo-backed double insert; test adapters against the real repo-backed store.
