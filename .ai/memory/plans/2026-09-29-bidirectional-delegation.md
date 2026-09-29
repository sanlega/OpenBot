# Bidirectional delegation (CoS <-> worker Bots)

Status: design draft, pending the research report (OpenClaw, Hermes, A2A, LangGraph, Claude Code
subagents, Codex collab agents). Implement only after reconciling with it.

## Problem (live, 2026-09-29)

The user asked the Chief of Staff (CoS) for a deploy bot plus a credentials request. The CoS created
the bot, delegated with `send_message` and asked the user for credentials. The worker then stopped
and nothing came back to the CoS. Root causes found in the logs and code:

1. Delegation is fire and forget. `send_message` wakes the recipient (`handoff.sent` ->
   `wakeOnBotMessages`), but nothing sends the outcome back. The return path depends on the worker
   model choosing to call `send_message`.
2. A worker's `message_user` lands in the worker's own thread, not in the conversation the user is
   having with the CoS.
3. `request_approval` (MCP) inserted the approval row twice (the repo-backed store already writes
   it) and crashed with `UNIQUE constraint failed: approvals.id`. Fixed in this change with a test.
4. `maxHops` is 4 and every bot-to-bot message adds a hop, so task -> report -> answer -> report
   exhausts the chain and pauses it: the next handoff is refused and the chain stays paused.
5. Loop guards (pair rate limit, repeated content, Jev loop gate) treat harness-generated reports
   like model chatter.

## Target design

- A delegation is derived, durably, from the worker thread: the latest task message in the worker's
  thread on the chain, authored by another Bot, names the delegator (no schema change).
- Return path is a harness guarantee: when a turn started by a `task` handoff ends (completed,
  failed, interrupted, refused), the harness sends a `report` handoff to the delegator with status
  and the worker's final text. The delegator wakes and tells the user in its own conversation.
- A worker's `message_user` (blocker, decision, result) during a delegated turn goes to the delegator
  as a report instead of the user's inbox; the CoS relays it, keeping the user in one conversation.
- Reports do not consume hops beyond the task's, skip the rate/repeat/Jev loop guards, and never
  trigger a report of their own (no ping-pong). A report to a delegator is delivered even when the
  chain is at its hop limit.
- Handoff events carry `kind: task | report` and a `status`, so the UI and Activity can show a
  delegation's state (working, blocked, done, failed).
- Prompts: the worker is told its final message is returned to whoever asked; the CoS is told a
  report is a worker's result and to relay to the user, re-delegating only when needed.

## Tests

- Unit: report on completed/failed/interrupted; no report on a report; hop budget; guards skipped;
  message_user routed to the delegator; delegator lookup ignores reports.
- Live isolated harness with the fake engine, then real Codex/Claude.
