# OpenBot — social posts, ready to publish

Repo: https://github.com/sanlega/OpenBot · Releases: https://github.com/sanlega/OpenBot/releases/latest

---

## 1. X/Twitter — launch thread

**Tweet 1 (hook):**
I kept running Claude Code, Codex and a couple other CLI agents in a pile of
terminal tabs, losing track of who was doing what.

So I built OpenBot: a desktop app that turns them into one AI team, led by a
Chief of Staff bot.

Open source, local-first, no hosted backend. 🧵

**Tweet 2:**
Each Bot gets a role, an engine (Claude Code, Codex, Cursor, Gemini CLI, Grok
Build, or a local model via Ollama/LM Studio), its own permissions and tools.

The Chief of Staff takes your request, does it itself or hands it to the right
Bot — and only comes back when there's a result.

**Tweet 3:**
Your keys never leave your machine. OpenBot has no hosted backend and ships no
bundled credentials — you sign in with the CLIs you already use.

**Tweet 4:**
Anything with side effects outside the shared workspace asks first — plain
language, the exact command, a risk level. Allow once / Always allow / Deny.
No wall of JSON to parse at 11pm.

**Tweet 5:**
Bots can also drive a virtual computer (Docker + Chromium) to browse the web.
You watch every step live in the chat and can take over the mouse/keyboard any
time.

**Tweet 6 (CTA):**
Free, MIT licensed, still an early preview. macOS / Windows / Linux installers
on the releases page — would love bug reports and "this broke on my setup"
feedback just as much as stars 🙏

https://github.com/sanlega/OpenBot

---

## 2. X/Twitter — single standalone post (use if not threading)

Your AI team, on your machine.

OpenBot runs Claude Code, Codex, Cursor, Gemini CLI and local models as a
roster of Bots, led by a Chief of Staff that delegates work and asks before
anything risky.

No hosted backend. No bundled keys. Open source (MIT).

https://github.com/sanlega/OpenBot

---

## 3. LinkedIn

Most "AI agent" tools ask you to hand your API keys to someone else's server
and hope for the best.

I built OpenBot the other way around: a local-first desktop app that runs a
small team of AI Bots — each one backed by Claude Code, Codex, Cursor, Gemini
CLI, or even a fully local model — coordinated by a "Chief of Staff" bot that
delegates work and only interrupts you with a result or a decision that
actually needs you.

A few principles that shaped it:
→ No hosted backend. Your accounts and keys stay on your machine.
→ Approvals you can read in one glance — plain language, the exact command, a
   risk level — for anything with side effects outside the workspace.
→ Bots can drive a virtual computer to browse the web, and you can watch or
   take over live.
→ Routines automate recurring work, starting as dry runs until you trust them.

It's free and open source (MIT), and still an early preview — I'm looking for
people willing to try it on their own setup and tell me what breaks.

https://github.com/sanlega/OpenBot

#AI #opensource #buildinpublic #developertools

---

## 4. Reddit — r/LocalLLaMA (and cross-post fit: r/selfhosted, r/ClaudeAI)

**Title:** I built OpenBot — a local-first desktop app to run Claude Code, Codex, Cursor and local models as one AI team

**Body:**
Been using Claude Code and Codex from the terminal for a while, and started
running several agent sessions in parallel for different parts of a project.
Keeping track of which terminal tab was doing what got old fast, so I built
OpenBot.

It's a desktop app (Electron, local SQLite, no hosted backend) that gives each
agent a "Bot" identity — a role, an engine, and a model — in a chat that feels
like a team messenger. A "Chief of Staff" bot takes your request, does it
itself or hands it to the right specialist Bot, and creates a new Bot only
when an existing one genuinely can't do the job.

Engine support: Claude Code, Codex, Cursor, OpenCode (incl. **local models via
Ollama or LM Studio**), Gemini CLI, Grok Build, or anything else that speaks
the Agent Client Protocol.

Things I specifically built for this crowd:
- **No hosted backend, no bundled credentials.** You sign in with the CLI
  tools you already use (`claude auth login`, `codex login`, `ollama` running
  locally, etc.). OpenBot never sees your keys.
- **Approvals in plain language** for anything with side effects outside the
  shared workspace — exact command, risk level, Allow once / Always allow /
  Deny.
- **Optional Dockerized virtual computer** (Xvfb + Chromium + noVNC) so a Bot
  can browse the web — you watch it live and can take over any time.
- **MCP connector gallery** for adding tools per Bot.

MIT licensed: https://github.com/sanlega/OpenBot

It's an early preview — desktop app, approvals, routines, connectors and
computer use are covered by automated tests and I've run computer-use against
live sites, but I haven't tested every provider × OS combination yet. Would
genuinely appreciate people trying it on setups I don't have and filing
issues for whatever breaks.

---

## 5. Reddit — r/selfhosted (framing tuned for that sub)

**Title:** Self-hosted, local-first alternative to cloud "AI agent" platforms — OpenBot (open source, MIT)

**Body:**
If you're already self-hosting things and wary of handing API keys to another
SaaS "agent platform," I built OpenBot as the local-first version: a desktop
app, no hosted backend, SQLite by default (Postgres by URL if you want it),
and every credential stays on your machine in an encrypted vault.

It runs a small team of AI "Bots" (Claude Code, Codex, Cursor, Gemini CLI,
Grok Build, or fully local models through Ollama/LM Studio), coordinated by a
Chief of Staff bot that delegates work and asks before anything with side
effects outside the shared workspace — plain-language approval cards, not a
JSON diff to parse.

Optional extras if you want them, both off by default:
- A Dockerized virtual desktop (Xvfb + Chromium + noVNC) so Bots can browse
  the web — watchable live, take-overable any time.
- Phone pairing over your own Wi-Fi, Tailscale, or a Cloudflare Tunnel —
  end-to-end encrypted, no third-party relay.

MIT licensed, installers for macOS/Windows/Linux or build from source:
https://github.com/sanlega/OpenBot

Early preview — feedback and issues very welcome, especially "this broke on
my setup."
