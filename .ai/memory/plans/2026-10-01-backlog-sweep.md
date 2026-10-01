# Plan: backlog sweep after v0.1.18

_Owner's goal (2026-10-01): add every worthwhile idea to the backlog and implement and test all
of them; independent verifier agents review the app's design and its functionality; do not stop
below 10/10._

## Items (mark when implemented AND tested)
Agents and safety
- [x] K1 Refusals reach every engine: after a denied action, Codex and ACP turns get the
      anti-detour text steered in (Claude already gets it in the permission prompt)
- [x] K2 "Interrupted is not denied": a card cut by a restart or stop tells the next turn the
      user did not refuse it
- [x] K3 Native tool loops are acted on: a repeated identical engine tool call (Bash, Read...)
      gets a loop reminder steered into the turn (shadow → on), with a setting to turn it off
- [x] K4 Connector start-up reminder: a connector tool that seems missing may still be starting
Delegation
- [x] L1 Cancel a delegated task (tool + UI), cascading to the tasks it delegated
- [x] L2 Depth limit for delegation chains (a worker's worker's worker is refused)
- [x] L3 Task board: every delegated task with state, owner, worker and result (UI screen)
Settings and data
- [x] M1 Defaults for new bots in Settings (engine routing, permission preset, computer)
- [x] M2 "Reset OpenBot" (red, typed confirmation): removes bots, chats, memories, routines and
      approvals, keeps keys, logins and the workspace
- [x] M3 Performance view: latency medians and prompt-cache reuse per bot (/api/usage data)
Computer
- [x] N1 Connector tabs and browser_* tools no longer close each other's tabs
- [x] N2 Files panel in the Computer tab: browse and open workspace files, last VM commands
- [x] N3 Visible plan: the engine's todo list (TodoWrite / plan updates) shown in the turn
Engines and first run
- [x] P1 Re-detect engines without restarting (button + after setup changes)
- [x] P2 First-run greeting from the Chief of Staff after setup (once)
Remote access
- [x] R1 An unpaired device sees "This device isn't paired" instead of "Can't reach OpenBot"
- [x] R2 The Cloudflare tunnel token is kept in the vault and the tunnel restarts with the app
      (already true: `serve` resumes it from the vault for both the CLI and the desktop app;
      covered by `cloudflare-tunnel.test.ts`)
- [x] R3 Streams recover after a harness restart while a client stays connected (test)
Quality
- [x] Q1 C11 eval runner: `openbot eval <cases>` on the real harness with fake or real engines,
      Jev or rules as judge, versioned cases in `evals/`
- [x] Q2 Code-signing ready: release workflow signs/notarizes when the owner adds certificates
      (skipped cleanly without them)
- [x] Q3 Firecracker research note (stronger per-bot isolation), with a recommendation

Not opportune now (documented, not built): D1 hot daemon update (images are republished per
release), B6 Web Bot Auth (few sites accept it), testing Grok/Gemini (no install/account here).

## Verification
Every item: unit/E2E tests; live checks where a real engine or the VM is involved. Verifier
agents (design/UX, functionality) score the result; findings are fixed until both give 10/10.

## Outcome (2026-10-01)
All items done and tested. Added on the way, from the verifiers' findings: D-036 (local owner
key; proxied and rebound requests are never the owner; Origin guard; owner-only engine routes;
built-in deny for the harness port and the key file), plain-language errors everywhere
(`friendlyError`), AA contrast tokens, a dates helper, Health/Tasks/Files/Speed/Memory/dialog
UX fixes, and Activity naming the task a waiting card belongs to.
Verifier scores: functionality 6 → 8 → 8 → 9 → 9.5 → 7 (new P1 bugs) → 8 → 9 → 9 → 9.5 → 10;
design 6 → 8.5 → 9.5 (final pass pending at the time of writing).
Checks: unit suites, 26 browser E2E (incl. reconnect after restart and the local owner key),
the Electron smoke test, `openbot eval` on the fake engine and one real-engine case.
