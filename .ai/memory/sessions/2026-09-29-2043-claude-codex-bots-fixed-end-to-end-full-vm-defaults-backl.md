# Codex Bots fixed end to end, Full+VM defaults, backlog #8-#10; review pending

- **Fecha**: 2026-09-29 20:43
- **Agente**: claude
- **Rama**: main @ c7b25ea

Made Codex Bots work end to end (found via the owner's Chief failing), set Full+VM as Bot defaults, filed backlog #8-#10, and started an independent review.

## Done
- Codex: private CODEX_HOME, thread params (instructions, approvals, sandbox, MCP), approval mapping per kind (MCP elicitation shape), thread filtering, ThreadIndex, MCP token file, mailbox auto-allow for OpenBot tools. D-027.
- Defaults: new Bots are Full + computer docker (D-028); E2E helper pins workspace_write for permission scenarios.
- Verified: real Codex CLI conformance tests (6), a real isolated harness with a Codex Chief delegating over two turns, Full vs workspace_write approvals. 1006 unit tests, 18 E2E.
- Issues: #8 shell in the VM, #9 defaults/Settings, #10 red reset button; #7 updated.

## Next
- Read the Opus reviewer's report, fix findings, commit and push, then ask the owner to release (v0.1.10) and install.
- #8 (shell inside the VM), #9 Settings-level default, #10 reset button.

## Retro
- Worked: probing the real CLI's raw notifications and parameters before touching OpenBot found four independent root causes; a real harness run with the exact failing scenario proved the fix.
- Failed: I released a parser-only fix (v0.1.9) and told the owner it should now work; the deeper wiring (instructions, MCP answer shape, private home) was still broken. Re-run the owner's exact scenario end to end before saying it works.
- Improve: for each engine keep an opt-in live conformance suite that covers instructions, MCP tool call, approval shape, resume; run it after every CLI update.
