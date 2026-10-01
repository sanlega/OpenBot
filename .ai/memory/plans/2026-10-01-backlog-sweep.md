# Plan: backlog sweep after v0.1.18

_Owner's goal (2026-10-01): add every worthwhile idea to the backlog and implement and test all
of them; independent verifier agents review the app's design and its functionality; do not stop
below 10/10._

## Items (mark when implemented AND tested)
Agents and safety
- [ ] K1 Refusals reach every engine: after a denied action, Codex and ACP turns get the
      anti-detour text steered in (Claude already gets it in the permission prompt)
- [ ] K2 "Interrupted is not denied": a card cut by a restart or stop tells the next turn the
      user did not refuse it
- [ ] K3 Native tool loops are acted on: a repeated identical engine tool call (Bash, Read...)
      gets a loop reminder steered into the turn (shadow → on), with a setting to turn it off
- [ ] K4 Connector start-up reminder: a connector tool that seems missing may still be starting
Delegation
- [ ] L1 Cancel a delegated task (tool + UI), cascading to the tasks it delegated
- [ ] L2 Depth limit for delegation chains (a worker's worker's worker is refused)
- [ ] L3 Task board: every delegated task with state, owner, worker and result (UI screen)
Settings and data
- [ ] M1 Defaults for new bots in Settings (engine routing, permission preset, computer)
- [ ] M2 "Reset OpenBot" (red, typed confirmation): removes bots, chats, memories, routines and
      approvals, keeps keys, logins and the workspace
- [ ] M3 Performance view: latency medians and prompt-cache reuse per bot (/api/usage data)
Computer
- [ ] N1 Connector tabs and browser_* tools no longer close each other's tabs
- [ ] N2 Files panel in the Computer tab: browse and open workspace files, last VM commands
- [ ] N3 Visible plan: the engine's todo list (TodoWrite / plan updates) shown in the turn
Engines and first run
- [ ] P1 Re-detect engines without restarting (button + after setup changes)
- [ ] P2 First-run greeting from the Chief of Staff after setup (once)
Remote access
- [ ] R1 An unpaired device sees "This device isn't paired" instead of "Can't reach OpenBot"
- [ ] R2 The Cloudflare tunnel token is kept in the vault and the tunnel restarts with the app
- [ ] R3 Streams recover after a harness restart while a client stays connected (test)
Quality
- [ ] Q1 C11 eval runner: `openbot eval <cases>` on the real harness with fake or real engines,
      Jev or rules as judge, versioned cases in `evals/`
- [ ] Q2 Code-signing ready: release workflow signs/notarizes when the owner adds certificates
      (skipped cleanly without them)
- [ ] Q3 Firecracker research note (stronger per-bot isolation), with a recommendation

Not opportune now (documented, not built): D1 hot daemon update (images are republished per
release), B6 Web Bot Auth (few sites accept it), testing Grok/Gemini (no install/account here).

## Verification
Every item: unit/E2E tests; live checks where a real engine or the VM is involved. Verifier
agents (design/UX, functionality) score the result; findings are fixed until both give 10/10.
