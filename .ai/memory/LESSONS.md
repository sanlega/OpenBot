# Lecciones

Memoria rápida de la automejora (estilo Reflexion): una línea por lección, concreta y
accionable ("antes de X, haz Y porque Z"). Se añaden con `.ai/bin/mh learn "..."`.
La skill `self-improve` las consolida en skills, contexto o protocolo y las retira de aquí.

- 2026-09-27 [unknown] Before calling a milestone done, check that each E2E assertion matches the milestone sentence; fakes-only unit tests per package do not catch broken wiring between packages (approvals, caps, chat history all passed unit tests while broken end to end).
- 2026-09-27 [unknown] Mocks of another package's API drift: run the client (e.g. packages/ui) against the real server in at least one E2E; the UI mock here disagreed with the server on WS frames, 8 response shapes, and even with the UI's own setup wizard.
- 2026-09-27 [unknown] Event bus notifications can arrive out of seq order (publish awaits an async append before notifying); never deduplicate live events by 'highest seq sent'.
- 2026-09-27 [unknown] E2E that create Bots through the API hid a first-run dead end (no CoS, no create-bot UI). Keep one E2E that starts from a fresh setup and drives only the UI.
- 2026-09-27 [unknown] UI reducers must not assume bus order: create per-turn records lazily from any turn-scoped event (tool.started can precede turn.started).
- 2026-09-27 [unknown] Before packaging Electron, run a SQLite query under Electron's embedded Node runtime: electron-rebuild can succeed even when the native addon's Node minimum exceeds Electron's bundled Node, leaving the packaged app crashing at startup.
- 2026-09-27 [unknown] When replacing the Docker computer image, reuse the existing anonymous /workspace volume and keep the old container stopped for rollback; otherwise its workspace becomes invisible to the new container.
- 2026-09-28 [unknown] With several agents in one working tree, commit with an explicit pathspec (git commit -- <paths>) and check git diff --cached first: another agent's staged deletions (git rm) ride along with any plain git commit.
- 2026-09-28 [unknown] A setup step that only validates a secret must also persist it: test that the vault holds the key after validate, not just that the response says ok (the TypeSafe key was never saved, so Jev silently fell back for days).
- 2026-09-28 [unknown] On Windows, electron-builder's win target fails extracting winCodeSign (ERROR: Cannot create symbolic link) unless run from an elevated (Administrator) terminal or with Developer Mode on; a first Windows install/build needs that elevated terminal at least once for pnpm --filter @openbot/desktop run dist / pack.
- 2026-09-28 [unknown] On a fresh Windows checkout, 'pnpm install' can silently skip the platform-specific @rolldown/binding-win32-x64-msvc optional dependency (rolldown backs vitest/vite here), making every 'pnpm ... test' fail at startup with 'Cannot find native binding'. Fix: 'pnpm install --force' once to force full re-resolution of optional deps; a plain re-run of 'pnpm install' does not fix it since it treats the lockfile as already satisfied.
- 2026-09-28 [unknown] better-sqlite3 (N-API prebuild) segfaults on Windows under Node 22.11.0 when opening any database (new Database(...)), even after a from-scratch node-gyp rebuild — it's a genuine Node-version incompatibility, not a corrupted/missing binary. Upgrading to Node >=22.12.0 (the project's own stated minimum) fixes it immediately with the same prebuild, no reinstall needed. Reproduce directly with plain node -e (outside vitest) to confirm before chasing pnpm/native-module red herrings.
