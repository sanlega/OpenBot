# Computer control with Jev: research and recommendations

_Research date 2026-09-28. Read-only; no repo changes._

## 0. Why the YouTube run stalls (diagnosis from the code)

- **`target_index` options carry no meaning.** `buildComputerQuestions` sets every option to `"Observed element at index N"` (`packages/decisions/src/questions/computer.ts`). To answer, Jev has to look up index N in `observed_elements`. TypeSafe's jev-1.13 limitations page says Jev answers questions that need **indirection** or several reasoning hops "less reliably", "does not count reliably", and loses accuracy as **irrelevant state** grows ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)). SeeAct found the same thing for LLM grounding. Putting the element's text in each option ("textual choices") scored 39.1% step success. Element attributes scored 16.1%, and Set-of-Mark image labels scored 20.3% ([SeeAct](https://arxiv.org/html/2401.01614)).
- **The state is too large and mostly irrelevant.** The YouTube home page has up to 80 elements, mostly video tiles. The goal also has two steps in one sentence ("search for X **and** click the first result").
- **`op` and `target` are asked separately.** They run as independent parallel questions, and TypeSafe notes that consistency between separate questions is not guaranteed ("structural invariants"). The loop escalates if **either** answer's confidence is below 0.5. For `op`, confidence is `(n·peak−1)/(n−1)` ([confidence](https://docs.typesafe.ai/confidence.md)). With 8 ops, the top op needs about 56% probability just to avoid escalation. On a page where "click consent", "click search box" and "type" are all plausible, that bar is easy to miss.
- **Jev picks the whole plan every step.** TypeSafe positions Jev for "narrow, typed questions" with "control flow … in code", and says it is not an agent or planner ([how to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md), [coding agents](https://docs.typesafe.ai/introduction/coding-agents.md)).
- **No fallback between Jev and the human.** Low confidence goes straight to the user ("I wasn't sure…"). It never goes to the engine, which is already in the loop and good at planning.

## 1. What TypeSafe/Jev documents

- TypeSafe publishes no browser or computer-use guidance. The closest pattern is the function-calling recipe. It handles single-step dispatch only, over 10 functions and 54 parallel questions, with no multi-step planning ([function calling](https://docs.typesafe.ai/cookbooks/function_calling)).
- Limits: up to **255 options per Choice** ([API](https://docs.typesafe.ai/api)). The state size limit is not documented. English works best ([state](https://docs.typesafe.ai/concepts/state.md)).
- **Large catalogs use a two-stage pattern.** A wide Choice over 182 options, each with a short (≤60 character) description, produces a top-3 shortlist. A second request then checks those 3 with full descriptions ([skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md)).
- Options can be **structured objects** (`what`, `not_for`, `examples`) to "sharpen the boundary between options" ([advanced](https://docs.typesafe.ai/primitives/advanced.md)).
- Batching questions barely changes latency ([primitives](https://docs.typesafe.ai/primitives)). Thresholds should differ per action by consequence: roughly <0.5 human, 0.5–0.9 verify, >0.9 auto ([confidence](https://docs.typesafe.ai/confidence.md), [routing](https://docs.typesafe.ai/patterns/confidence-routing)).
- Errors 429/529 should be retried with exponential backoff ([API](https://docs.typesafe.ai/api)). No latency SLA is published.

## 2. How established agents make this work

| Concern | Practice |
|---|---|
| **Planner + executor** | Agent-E has a planner that delegates one subtask at a time to a navigator: 73.2% on WebVoyager, about 25 LLM calls and ~150 s per successful task ([Agent-E](https://arxiv.org/html/2407.13032)). Skyvern went from 45% (actor only) to 68.7% (+planner) to 85.85% (+validator) ([Skyvern 2.0](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/)). Stagehand says to "break your task into single-step actions" ([act](https://docs.stagehand.dev/v3/basics/act)). |
| **Candidate pruning** | SeeAct ranks elements with a cross-encoder, keeps the top 50, and asks multiple choice in groups of 17 with a "none" option ([SeeAct](https://arxiv.org/html/2401.01614)). Agent-E switches between DOM "distillation" modes (text only, input fields, all fields). |
| **Element indexing** | browser-use indexes only interactive elements. It drops elements covered by others using **paint order** (for example, page content under a modal) and marks newly appeared elements ([DeepWiki](https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection), [PR #5159](https://github.com/browser-use/browser-use/pull/5159)). |
| **AX tree vs pixels** | Playwright MCP uses accessibility snapshots with element refs ("deterministic… avoids ambiguity") and has `browser_type` with `submit` ([playwright-mcp](https://github.com/microsoft/playwright-mcp)). In ComponentBench, the same model reached 83.1% with the accessibility tree and 48.9% with pixel coordinates ([ComponentBench](https://arxiv.org/abs/2608.18307)). |
| **Observe → act, cached** | Stagehand's `observe()` returns candidate *actions* (description + method + selector). Replaying them is "2-3x faster", and results can be cached ([observe](https://docs.stagehand.dev/v3/basics/observe)). |
| **Change feedback / success** | Agent-E reports what changed after each action through a MutationObserver ("a popup has appeared…"). Skyvern's validator catches "silent failures". Anthropic's guidance: after each step, check whether the right outcome happened before moving on ([Claude computer use](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool)). |
| **Stall recovery** | WebVoyager allows at most 15 steps and has a "jump to search engine" and a "back" action. 44.4% of its failures were "navigation stuck" ([WebVoyager](https://arxiv.org/html/2401.13919)). OpenAI suggests bounded steps, time and cost, and verifying outcomes ([OpenAI CUA](https://developers.openai.com/api/docs/guides/tools-computer-use)). |
| **Shortcuts** | Skim builds destination URLs from site templates and passes only failures to the full agent: 33.4% lower latency and 1.9x lower cost with no accuracy loss ([Skim](https://arxiv.org/abs/2605.16565)). Anthropic recommends keyboard shortcuts for awkward widgets. |
| **Consent overlays** | These are usually handled by rules, not by the model. DuckDuckGo's **autoconsent** (MPL-2.0, npm, works with Playwright/Puppeteer) has rules per consent-management platform for opt-in and opt-out ([autoconsent](https://github.com/duckduckgo/autoconsent)). |
| **Latency** | browser-use measures about 3 s per step and 68 s per task. Each screenshot adds about 0.8 s. Output tokens cost far more time than input tokens, so actions are kept to 10–15 tokens ([speed](https://browser-use.com/posts/speed-matters)). |

## 3. Recommendations for OpenBot, prioritized

Impact is relative to the YouTube failure. Effort: S = hours, M = 1–2 days, L = more than 2 days.

### P1: Put the element's text in each option, and ask one joint "action" question (impact: high, effort: S–M)
Replace the separate `op` and `target_index` questions with a single `action` Choice. Its options are candidate actions built in code, Stagehand style:
`"a12": {what: "click button 'Accept all' (in cookie dialog)"}`, `"t3": "type into searchbox 'Search'"`, `"k_enter": "press Enter to submit the focused field"`, `"scroll_down"`, `"wait"`, `"done"`, `"blocked"`, `"none": "none of these fits"`.
The model picks one meaning directly, with no lookups. There is one confidence to gate on, and op and target can no longer disagree. Build candidates from role: links and buttons get click, textboxes get type, selects get select.
Files: `packages/decisions/src/questions/computer.ts`, `packages/computer/src/fast-loop.ts` (answer parsing and bands), `packages/decisions/src/fake-decision-service.ts`, and the evals in `packages/computer/src/evals/`.

### P2: The engine plans atomic sub-goals; Jev only grounds them (impact: high, effort: M)
Add `steps: string[]` to `computer_task`, for example `["accept cookies if asked", "search for 'sanlega'", "open the first video result"]`, or have OpenBot ask the engine for them. The loop sends Jev **only the current sub-goal**, plus the overall goal as low-priority context, and moves on when a per-sub-goal `noul` ("is `subgoal` now satisfied?") is at least 0.85. This follows Agent-E and Skyvern's planner→actor→validator structure.
Files: `packages/mcp/src/tool-definitions.ts`, `tool-schemas.ts`, `handlers.ts`, `packages/computer/src/task-manager.ts`, `fast-loop.ts`, and `packages/runtime/src/prompt.ts` (tell engines to pass steps). Changing the `computer_task` schema may touch contracts, which needs coordinator review.

### P3: Handle consent overlays in code before Jev runs (impact: high on EU sites, effort: S; M with autoconsent)
First, in the observation and act phase, match dialog buttons whose text is on a list: "Accept all", "Reject all", "Aceptar todo", "Rechazar todo", "Alle akzeptieren", "Tout accepter", and so on. Make the preferred choice a setting, defaulting to *reject* for privacy. YouTube's EU consent can appear as a full page (`consent.youtube.com`) rather than a `role=dialog`, so match on the URL host too. Later, inject `@duckduckgo/autoconsent` through CDP (MPL-2.0 is compatible as an unmodified dependency). Log each automatic click as a step so it appears in the timeline.
Files: `packages/computer/src/observation/dom.ts`, a new `packages/computer/src/overlays.ts`, `fast-loop.ts`, and the connector/computer settings.

### P4: Deterministic "search" primitive and URL shortcuts (impact: high, effort: S)
Add a `search <query>` macro. It finds `role=searchbox|combobox`, `input[type=search]`, or a field whose name or placeholder contains "search". It focuses the field, types the query and presses Enter, like Playwright MCP's `submit`. Also allow an optional URL-template table (YouTube `/results?search_query=`, Google, Wikipedia, GitHub). The engine can still pass `startUrl` directly, and the tool description should encourage it. The sanlega task then takes about two Jev decisions instead of five or more.
Files: `fast-loop.ts` (a macro op), `computer.ts` (a `search` candidate), `tool-definitions.ts` and `prompt.ts` (hint engines to use `startUrl` or search URLs).

### P5: Rank and prune candidates before asking Jev (impact: medium-high, effort: S–M)
- Drop occluded elements. At each element's center, check `document.elementFromPoint`: if a modal is open, everything outside it is covered, so keep only the modal's controls. This is browser-use's paint-order idea.
- Deduplicate repeated tiles, and keep at most about 15–25 candidates ranked by cheap lexical overlap with the sub-goal (for example, "search" favors the searchbox and "first result" favors the first `a#video-title`). SeeAct used 17-option groups.
- For larger sets, use TypeSafe's two-stage shortlist: a wide Choice, then a top-3 check.
- Keep roles and labels short and in English, and include position hints (such as "result #1") so Jev never has to count.
Files: `observation/dom.ts`, `observation/types.ts`, a new `packages/computer/src/candidates.ts`.

### P6: Low confidence goes to the engine before the human (impact: medium-high, effort: M)
When the action band is below `auto`, the task pauses with `needsDecision: {subgoal, candidates[top 5 with probabilities]}`. `computer_status` returns it, and the engine answers through `computer_steer({choice})` or a new sub-goal. Escalate to the user only if the engine also declines, or if the step is risky. This keeps Jev as the fast path and the engine as the slow, smart path, which is how Skim cascades to the full agent.
Files: `task-manager.ts`, `fast-loop.ts`, `packages/mcp/src/handlers.ts` and `tool-definitions.ts`, and the UI step timeline.

### P7: Per-action thresholds and a margin rule (impact: medium, effort: S)
Follow TypeSafe's "each action type has its own threshold". Reversible actions (scroll, wait, clicking a non-destructive link, focus) may run in the `confirm` band when the gap between the top two options is at least 0.3. Type, submit and destructive actions keep 0.9 or approval. Keep the thresholds in `fast-loop.ts`, not in `bandConfidence` in contracts, to avoid a contracts change.

### P8: Change feedback and outcome checks (impact: medium, effort: S)
After each action, compare the previous and new observation: URL changed, dialog closed, new elements, field value set. Add a one-line `last_result` ("clicked 'Accept all' → dialog closed") to `recent_steps`, like Agent-E's linguistic feedback. If nothing changed after a click, count it toward the stall threshold straight away.
Files: `fast-loop.ts`.

### P9: Jev availability (impact: medium, effort: S)
- Retry once on 429, 529 or a network error, with jittered backoff between 250 and 800 ms, inside `packages/decisions/src/jev-client.ts`.
- Lower the `decide` timeout for computer calls from 20 s to about 3–5 s, retry once, then use the P6 engine fallback instead of stopping.
- Cache decisions keyed by `(url pattern, sub-goal, candidate labels hash)` for repeated routines (Stagehand-style caching).
- Show the recent Jev p50 and p95 latency and error rate in Settings → Jev.

### P10: Budgets (impact: low-medium, effort: S)
Lower `DEFAULT_MAX_STEPS` from 50 to about 15 per sub-goal plus a task-level cap of about 30, in line with WebVoyager (15) and OpenAI (20). Add a "back" action and a single "stuck → go to search URL" recovery before escalating.

## Suggested order
Do P1, P3, P4 and P5 first. They are all local to `packages/computer` and `packages/decisions` and should fix the YouTube case. Then P2 and P6, which change the engine↔Jev contract through MCP. P7–P10 are polish. Add a YouTube-like fixture with a consent dialog, a search box and a results page to `packages/computer/src/evals/`. Measure decision count, escalation rate and per-step latency before and after each change.
