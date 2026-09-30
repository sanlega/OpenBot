# More engines: ACP driver (OpenCode, Cursor, Gemini, Grok, custom) and local models

- **Fecha**: 2026-09-30 12:14
- **Agente**: claude
- **Rama**: sanlega/add-local-and-cli @ 21e9c86

## Done
- `@openbot/engines-acp`: generic ACP driver (official SDK), profiles for OpenCode, Cursor, Gemini, Grok and owner-added agents (`~/.openbot/engines.json`).
- Local models via OpenCode: Ollama (derived 32k-context model) and LM Studio (`lms load -c`).
- Open `EngineId`, `EngineDescriptor`, `/api/engines` descriptors, `/api/engines/custom`, doctor checks, route question aware of engines/local models (and model ids with `:`).
- UI: Settings > Engines (status, sign-in command, local models, custom agents), setup accepts any ready agent, friendly engine names.
- Cursor isolation (private home) and write fence; driver backstop for unasked writes outside the workspace.
- Live: `scripts/live/engines.mjs` 9/9 on OpenCode+Ollama, OpenCode+LM Studio, Cursor (copy of real home).

## Pending
- Owner review, merge to main, release. Grok and Gemini (past sign-in) untested live; macOS/Linux untested.

## Retro
- Worked: spiking the protocol by hand first (found Ollama's 4096-token truncation before writing the driver); the live harness scenario on a copy of the real home found three real bugs (Cursor writes without asking, owner hooks leaking, npm/PowerShell shims) that unit tests could not.
- Failed: bash heredocs into Python again mangled `\n` and `\b` (lesson already existed); writing patches as Python files through the Write tool avoided it. Git Bash PATH hid an installed Cursor CLI, so "not installed" was wrong at first: check with the app's own resolver.
- Improve: a harness helper to write multi-line code edits safely; `mh` could warn when a heredoc contains backslash escapes.
