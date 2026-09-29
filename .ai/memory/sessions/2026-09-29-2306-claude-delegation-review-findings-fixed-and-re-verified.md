# Delegation review findings fixed and re-verified

- **Fecha**: 2026-09-29 23:06
- **Agente**: claude
- **Rama**: main @ 584c1d1

Addressed the independent Opus review of the delegation pipeline (18 findings): turn-scoped routing, per-pair task cap, pending-turn and wait counters, restart handling for lost permission cards, stopped tasks, fenced worker text, lastReply leak removed, UI keyed by delegation id. 1105 unit tests, 23 E2E, live Codex and mixed-engine runs re-verified.

## Retro
- Worked: the adversarial review found real race and scoping bugs that unit tests and live runs missed; a live re-run after the fix caught nothing new, which is the point.
- Failed: I keyed routing on the bot instead of the turn at first; the review's scenario (another requester's task hijacked) was obvious in hindsight.
- Improve: when state is attached to a bot but the events are per turn, bind by turn from the start.
