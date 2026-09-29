# Multi-agent delegation: what other systems do (research, 2026-09-30)

Sources: OpenClaw docs (subagents, announce, operations, nesting, ask-user), Hermes Agent
(delegation), Claude Code (sub-agents, agent teams), Codex (subagents), OpenAI Agents SDK,
LangGraph (interrupts, supervisor), AutoGen (human-in-the-loop), A2A specification, MCP
(tasks, elicitation), Anthropic's multi-agent research system, Temporal (heartbeats).

## Patterns worth copying

1. Only the requester talks to the human. Subagents get no ask-user or messaging tools; their
   permission prompts and questions appear in the requester's view, naming the subagent.
2. The result returns on its own as a new turn of the requester ("announce"). No polling, no wait.
3. Task status comes from the runtime, not from the model's text. A child that ends with no output
   is a missing deliverable, not a success.
4. Explicit states with the same task id on resume: submitted, working, input-required,
   auth-required, completed, failed, canceled (A2A, MCP tasks).
5. Credentials stay out of band: the value never enters a model's context, only a reference.
6. Durability: write the completion before delivering it; deliver at least once; the consumer
   claims it so it takes effect once (Hermes). After a crash mark the task interrupted or unknown
   and let the requester decide; never relaunch blindly (OpenClaw, Hermes).
7. Stall detection by heartbeat; time spent waiting for a human is not work time (Hermes, Temporal).
8. Messages from other agents are marked as such and never carry consent (Claude Code teams).
9. Caps on depth, active children per requester and concurrency; stop cascades to the subtree
   (OpenClaw: 5 children per agent).
10. Large outputs go to artifacts and only references are passed (Anthropic, A2A).

## What OpenBot lacked (before D-029)

Fire-and-forget `send_message` with no return path; prompts telling the Chief not to wait and that
bots may message the user directly; refused turns that vanished; a worker's forms and cards in its
own thread; forms answered by re-routing the engine (context loss); ineffective limits; nothing
recovered after a restart.

## Implemented (D-029) and not

Implemented: 1-4, 6-9 (tracked delegations, runtime-decided state, card + wake in the requester's
thread, worker cards routed there, engine pinning, restart recovery, stall sweep, caps).
Not built: cascade cancel, task board in the UI, depth limit, artifacts for large results.
Plan and rationale: `.ai/memory/plans/2026-09-29-bidirectional-delegation.md`, D-029.
