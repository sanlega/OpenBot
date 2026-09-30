# OpenBot launch copy

## Strategy (one page)

**Value proposition.** OpenBot is a local-first desktop app for a small team of
persistent AI Bots. Instead of one chat window, you get a roster: each Bot has a
role, an engine (Claude Code, Codex, Cursor, Gemini CLI, Grok Build, or local
models via Ollama/LM Studio), permissions, and tools. A Chief of Staff takes your
requests, does the work itself or delegates, and only interrupts you with a
result or a decision that needs you. No hosted backend, no bundled credentials —
you bring your own accounts and keys, and they never leave your machine.

**Target audience.** Developers and power users who already use Claude Code,
Codex, Cursor or similar CLI agents and want to orchestrate several of them
instead of juggling terminal tabs; self-hosters and privacy-conscious builders
who want agent automation without handing keys to a SaaS; indie hackers who want
a "team" of AI workers for solo projects.

**Priority channels**
1. **Reddit** (r/LocalLLaMA, r/selfhosted, r/ClaudeAI, r/OpenSourceAI) — the
   audience already cares about BYO-keys, local-first, multi-engine. Highest
   intent-to-adoption ratio.
2. **Product Hunt** — broad early-adopter tech audience, good for a launch-day
   spike and backlink/SEO.
3. **X/Twitter** (#buildinpublic, #AIagents) — where indie devs and the
   Claude Code/Codex power-user crowd already hang out.

Secondary/stretch: **Hacker News (Show HN)** — strong fit given open-source +
technical depth, but higher bar and one-shot (don't resubmit if it flops).
**LinkedIn** — lower priority, mostly useful for reaching eng-manager/founder
audience evaluating team tools.

---

## Product Hunt

**Tagline (60 char max):**
Your AI team, running on your machine

**Description:**
OpenBot is a desktop app for a small team of persistent AI Bots — each one
powered by Claude Code, Codex, Cursor, Gemini CLI, or a local model. A Chief of
Staff takes your requests, does the work or hands it to the right Bot, and only
comes back when there's a result or it needs you. Approve risky steps in plain
language, watch Bots browse the web on a virtual computer, automate routines on
a schedule, and stay in the loop from your phone. No hosted backend, no bundled
credentials — bring your own accounts, keep your keys on your machine. Free and
open source (MIT).

**First comment (maker comment, post immediately after launch):**
Hey Product Hunt 👋

I built OpenBot because I was running Claude Code, Codex and a couple of other
CLI agents in a pile of terminal tabs, and kept losing track of who was doing
what. OpenBot turns that into a small team: a Chief of Staff bot that takes my
requests in one chat, does the work itself or delegates to the right specialist
bot, and only pings me when there's something to see or approve.

A few things I care about that shaped it:
- **No hosted backend.** Your keys and logins stay on your machine. I'm not
  running a server that touches your credentials.
- **Bring your own engine.** Claude Code, Codex, Cursor, Gemini CLI, Grok
  Build, or fully local models via Ollama/LM Studio — pick per bot.
- **Approvals you can actually read.** Anything with side effects outside the
  shared workspace asks first, in plain language, with the exact command and a
  risk level — not a wall of JSON.
- **A virtual computer bots can use**, that you can watch live and take over
  at any time.

It's free, open source (MIT), and still an early preview — real-world testing
across provider/OS combinations is ongoing. I'd love feedback, bug reports, and
"this broke on my setup" reports equally. Links below. 🙏

---

## Hacker News (Show HN)

**Title:**
Show HN: OpenBot – local-first desktop app to run a team of AI coding agents

**Body (first comment):**
OpenBot is a desktop app that runs a small team of persistent AI "Bots" — each
one backed by Claude Code, Codex, Cursor, Gemini CLI, Grok Build, or a local
model (Ollama/LM Studio) — in a chat that feels like a team messenger. A Chief
of Staff bot takes requests, does the work itself or hands it to the right Bot,
and creates a new Bot only when an existing one genuinely can't do the job.

Design choices I'd like feedback on:
- No hosted backend. Everything runs locally; you sign in to each engine with
  its own CLI (`claude auth login`, `codex login`, etc.), and OpenBot never
  sees your provider keys.
- A fast typed-decision layer (Jev, via TypeSafe) handles routing/safety
  micro-decisions (which model answers, is this notification worth
  interrupting you, is this step risky) in a few hundred ms, separate from the
  agent doing the actual work — it never writes or executes anything itself.
- Approvals read like a human wrote them: plain headline, the exact command,
  a risk level, Allow once / Always allow / Deny.
- Optional Dockerized virtual computer (Xvfb + Chromium + noVNC) so Bots can
  browse the web, watched live, takeover-able at any time.

MIT licensed, source at https://github.com/sanlega/OpenBot. Early preview —
desktop app, chat, approvals, routines, connectors and computer use are tested
end to end, but real provider/OS combinations are still getting manual
coverage. Happy to answer anything about the architecture or trade-offs.

---

## One-liner variants (bios, link previews, etc.)

- "Your AI team, in one local-first desktop workspace."
- "Run Claude Code, Codex, Cursor and local models as one team — on your machine."
- "A Chief of Staff bot for your other AI agents. Open source, local-first, BYO keys."
