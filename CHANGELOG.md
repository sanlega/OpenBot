# Changelog

## 0.1.20 — 2026-10-01

- Fixed: asking the Chief of Staff to create a bot ("Create a bot called Researcher…") was
  refused, and the Chief did the work itself. The check behind new bots now reads what you
  asked in the chat.

## 0.1.19 — 2026-10-01

- **Tasks screen.** See every job a bot handed to another bot, where it stands and what came
  back. Cancel one (and everything it handed on), or jump to the conversation where a bot is
  waiting for your answer. Hand-offs stop after three levels.
- **Computer > Files**: browse and preview the files your bots share (Markdown shown
  formatted), and see the commands a bot ran in its virtual machine.
- **See the plan.** When the engine keeps a to-do list (Claude, Codex), the turn shows it as a
  checklist with its progress.
- **Settings**: defaults for new bots (engine, permissions, computer); **Speed**, how fast each
  bot starts answering; **Reset OpenBot** to start over (typed confirmation; keys, logins and
  files are kept); and **Check again** in Engines: an engine you install or sign in to is
  picked up without restarting.
- **A warmer first run**: the Chief of Staff says hello once, with ideas to try.
- **Bots handle refusals and loops on every engine**: after you deny something they no longer
  look for a way around it, and a card nobody answered is not taken as a "no".
- **Safer local access.** Only OpenBot itself can act as you on this computer: other programs,
  other user accounts and web pages can no longer use its local address to control it, and bots
  cannot call it from their commands. The desktop app needs nothing from you. If you open
  OpenBot in a browser with `openbot serve`, use the link it prints (it ends in `#key=…`);
  browsers reaching it through Tailscale or a Cloudflare tunnel now need to be paired, like the
  phone app.
- A device that isn't paired now says so (instead of "Can't reach OpenBot"), and an open
  window reconnects by itself when OpenBot restarts.
- Clearer everywhere: errors are plain sentences, status colours are readable in light and dark
  mode, dates use one language, deleting a memory can be undone, and dialogs work fully from
  the keyboard.
- For developers: `pnpm eval` runs versioned checks of what bots do (`evals/`), on the fake
  engine or your real ones; release builds are signed when signing certificates are configured.

## 0.1.18 — 2026-10-01

- **Bots remember.** A bot keeps what it learns across conversations: your preferences and
  standing instructions, who people are, how it does its job. Facts about you are shared by
  every bot. Each bot has a **Memory** tab where you can see, fix or delete what it knows.
- **A safer, self-healing virtual machine.** Bots' commands no longer run as an administrator:
  they cannot read the virtual machine's control key or the browser's saved sessions, nor
  control the screens directly. Installing system packages still works (`sudo apt-get
install`). If the browser or the live view crashes, it comes back by itself, and a runaway
  command can no longer take the desktop down.
- **Settings > Computer > Health**: a self-check of the virtual machine (browser, live view,
  internet, clock, workspace, isolation) and a "Refresh the computer" button that starts a new
  one keeping your files and sign-ins.
- **More sign-ins are shared between bots**: apps that keep you signed in without cookies
  (Notion, Linear and similar) now stay signed in on every bot's screen, and Google no longer
  signs bots out for "suspicious" activity.
- **Bots no longer get stuck or go in circles.** A turn where the engine stops responding is
  restarted once and then reported, instead of hanging; a bot repeating the same call with the
  same result is told to change approach; pages behind Cloudflare, CAPTCHAs and similar walls
  are named instead of "I couldn't find the button", and routes that worked on a site are
  reused next time.
- **The Playwright connector works for bots in the virtual machine**: it drives the bot's own
  browser there, and can never read your sessions. You can limit the sites it may open.
- A bot working on a task from another bot only sends an email, posts or buys when you asked
  for exactly that; otherwise it prepares a draft. "Always allow" now allows just that command
  or that file. If OpenBot closes unexpectedly, the Chief of Staff tells you when it restarts.
- Fixed: a click on a page with a single button could do nothing and still report success.
- The virtual machine updates itself to this version the first time a bot uses it after the
  update, once no bot is using it (files and sign-ins are kept; packages bots installed with
  apt must be installed again).

## 0.1.17 — 2026-10-01

- **Bots whose computer is the virtual machine now work only there.** They no longer get a
  shell, files or a browser on your own computer: they run commands, read and write files and
  browse inside the virtual machine, where `/workspace` is your OpenBot workspace (the same
  files you see). The virtual machine now has git, the GitHub CLI, Python with pip, Node and
  build tools, and what bots install there is kept. A bot that should also work on your
  computer can be set to "Virtual machine + this computer" in its profile.
- **Bots read and click web pages themselves**, step by step, and see the page's text, instead
  of starting one automatic task after another. The automatic computer tasks no longer go in
  circles (repeated clicks, endless scrolling), a "describe this page" task finishes at once,
  and a "Leave site?" dialog no longer blocks the next page.
- **Fixed: a site signed in on one bot's screen showing signed out on another's.** The first
  page a bot opened could load before the shared sign-ins reached its browser.
- **Rename, clear or delete a bot** from the "⋯" button (or a right-click) on its row in the
  sidebar, each with a confirmation. A deleted bot's files stay in the workspace and the Chief
  of Staff keeps a note of what it did. **Settings > Data** clears every conversation at once.
- A bot's reply is now just its answer, without the running commentary it wrote while working
  (that stays in the turn's activity).
- Fixed the Chief of Staff failing to create a bot with the name of one you had deleted.
- The virtual machine updates itself to this version the first time a bot uses it (sign-ins
  and files are kept; software bots installed with apt must be installed again).

## 0.1.16 — 2026-09-30

- Bots share the virtual machine properly: a site one bot signs in to is signed in for every
  bot (and signing out signs everyone out), and sign-ins now survive a restart of the
  virtual machine.
- Bots share files with the virtual machine: your OpenBot workspace is `/workspace` inside it,
  and browser downloads land in the workspace's `downloads` folder, visible to every bot and
  engine. The first time a bot uses the computer after updating, OpenBot replaces the old
  virtual machine container once (sign-ins made there before were not kept anyway).
- Fixed the macOS app not opening ("OpenBot is damaged"): the app is now signed (ad hoc). On
  the first launch, allow it in System Settings > Privacy & Security > Open Anyway.

## 0.1.15 — 2026-09-30

- Fixed the new engines (OpenCode, Cursor, local models) seeming to be missing from a bot's
  model list: the list took about 7 seconds to arrive when something other than LM Studio was
  listening on its port, and until then only "Auto" showed. Model lists now load in the
  background when OpenBot starts, answer at once afterwards, and the list says when it is
  still loading.

## 0.1.14 — 2026-09-30

- Bots can run on more engines: **Cursor**, **OpenCode**, **Gemini CLI** and **Grok Build**,
  besides Claude Code and Codex, using your own accounts. Any other agent that speaks the Agent
  Client Protocol (Goose, Qwen Code, Copilot CLI...) can be added from Settings > Engines with
  its command line.
- **Local models**: with OpenCode installed and Ollama or LM Studio running, their models show
  up in a bot's model list and run on your computer, free and private. OpenBot gives them
  enough context for an agent (Ollama's default was cutting the instructions off).
- Settings > Engines shows every engine, whether it is installed and signed in (with the
  command to sign in), and which local models were found. The setup wizard accepts any ready
  engine.
- Jev picks among all your engines and keeps local models for light tasks.
- Cursor bots run apart from your own Cursor settings (your hooks, MCP servers and skills no
  longer reach them) and cannot write outside their workspace unless they have Full
  permissions; any engine that writes outside the workspace without asking is stopped.
- A reply made only of blank lines no longer shows as an empty message.

## 0.1.13 — 2026-09-30

- Bots finish what you ask without babysitting. A computer task no longer stops at the first
  doubt, failed click or page that doesn't change: it tries other ways first (waiting, closing a
  pop-up, scrolling, another link) and resumes from the same page when steered.
- Bots only interrupt you for data. A sign-in with no saved login, a verification code or a
  CAPTCHA pauses the task: give the username and password in the secure form (they are saved, so
  you're not asked again) or sign in yourself on the Computer tab, and the task carries on by
  itself.
- No more permission cards for ordinary steps: sending, connecting, posting, confirming and
  opening pages just happen. Only the button that actually pays or deletes something asks.
- The Chief and every bot share one way of working: the request is the permission, try other
  routes before giving up, check the result, ask only for what they can't get themselves.
- Fixed a bot opening Chrome on your computer instead of in the virtual machine (the Playwright
  connector is no longer given to bots whose computer is the virtual machine).
- A bot runs one computer task at a time on its screen; a new one replaces the unfinished one.

## 0.1.12 — 2026-09-30

- Fixed every command and file edit of your bots being rejected ("rejected by user", with no
  approval card): OpenBot's protection for its own `.openbot` folder also blocked the bots' own
  workspace on Windows. Bots can work in their workspace again; the database, vault, session
  tokens and Codex login stay protected.
- The reported server version is correct again.

## 0.1.11 — 2026-09-30

- Work handed from the Chief of Staff to another bot now comes back. When the bot finishes,
  fails, is stopped or gets blocked, you see a card in your chat with the Chief and the Chief
  takes a turn about it. Before, the bot could stop and nothing reached the Chief or you.
- A bot's questions stay in your conversation with the Chief: its forms, approval requests and
  permission cards appear there, the task shows as waiting for you, and your answer resumes the
  same bot on the same engine.
- Fixed `request_approval` failing with a duplicate-row error and leaving approval cards behind.
- A task nobody finishes can no longer bounce between the Chief and a bot forever: there are
  limits on messages per task and tasks per hour to the same bot. A task you stop is not restarted.
- After a restart, tasks that were running are marked interrupted and the Chief is told.
- Bot status no longer shares other bots' replies with every bot.

## 0.1.10 — 2026-09-30

- Codex bots (the Chief included) now work properly. They receive their instructions, can use
  OpenBot's tools (creating bots, messaging, computer tasks, saved logins), and their commands
  go through OpenBot's permission checks like Claude's do. Before, OpenBot's tools were being
  refused, bots never got their instructions, and the network was blocked.
- Bots run Codex from a private folder with only your login, so your own Codex plugins, MCP
  servers, skills and connected ChatGPT apps no longer leak into them. If your Codex login is
  kept in the system keyring, OpenBot tells you to run `codex login`.
- New bots default to Full permissions and the virtual machine, unless you configure
  otherwise. Existing bots keep their settings.
- Safer read-only detection for shell commands (PowerShell grouping and write-capable flags),
  wider protection for OpenBot's and Codex's own secret files, and bots' session tokens are
  deleted when their turn ends.
- Codex token usage is now counted, so spending limits apply to Codex bots.
- The first message to each Codex bot after updating starts a fresh Codex conversation.

## 0.1.9 — 2026-09-30

- Fixed Codex bots (the Chief included) answering "Finished without returning any text": a
  recent Codex update changed how it reports replies and tool calls, and OpenBot now reads the
  new format. Replies and the commands a bot ran show up again.
- With several Codex bots working at once, each one now only sees its own conversation, so
  their replies can't mix.

## 0.1.8 — 2026-09-30

- The Chief of Staff now hands real work to bots and creates the ones it needs, so it stays
  free to talk to you. Default limits are looser (10 bots, 8 new per day, 2 min between);
  limits you never changed are upgraded once.
- The Full permission preset no longer asks: commands, connector side effects and the Bot's
  own local-computer steps run without cards. Sensitive targets still ask.
- Bots can sign in to websites on their own. Save a login in Settings > Computer > Saved
  logins, or let a Bot ask you once with a secure field. OpenBot types it into the virtual
  machine; the Bot and the AI models never see the password.
- A Bot whose computer is the virtual machine only can no longer open browsers on your own
  computer.
- OpenBot starts Docker Desktop for you when it isn't running, and says plainly what to do
  if it can't. The virtual desktop no longer crashes on a failed start and recovers after
  an unclean stop (this needs the new desktop image, published with this release).
- A turn that stops at its step limit now says so and how to continue (limit raised from 50
  to 200 steps), and Codex conversations survive an app restart.

## 0.1.7 — 2026-09-29

- iPhone push notifications: OpenBot sends approval requests, questions, replies and
  pushed updates straight from your computer to Apple's push service. Add your Apple
  push key (.p8) in Devices > Phone notifications and use "Send a test". The key is
  stored in the vault only. Message text is included by default and passes through
  Apple; turn previews off to send generic text instead.
- Fixed the phone's live connection: encrypted WebSocket frames are now sent in the
  format the iPhone app can read, and in order, so sent messages no longer look stuck.

## 0.1.6 — 2026-09-29

- Cloudflare Tunnel is now set up once: the tunnel token is saved encrypted in the
  vault and the tunnel starts by itself whenever OpenBot opens. In Devices > Remote
  access you can change the public hostname, replace the token with a different one,
  start a stopped tunnel, or remove the token (which also stops the tunnel and forgets
  its hostname). The token is never shown or sent back to the interface.

## 0.1.5 — 2026-09-29

- Cloudflare Tunnel: the phone pairing QR now includes your tunnel's public address.
  OpenBot reads it from the tunnel's configuration when it can, and Devices > Remote
  access has a "Public hostname" field to enter it yourself (saved across restarts).
- Fixed a rare startup race where OpenBot could read a half-written network settings
  file and briefly listen on this computer only.

## 0.1.4 — 2026-09-29

- Cloudflare Tunnel now works out of the box: if `cloudflared` isn't installed,
  OpenBot downloads Cloudflare's official build once (checked against a pinned
  SHA-256) into its own data folder. A `cloudflared` already on your PATH is used
  as-is. Failures now say what went wrong instead of `spawn cloudflared ENOENT`.

## 0.1.3 — 2026-09-29

- Cloudflare Tunnel: real tunnel tokens are now accepted (they were rejected with
  "token does not look like a Cloudflare tunnel token"). You can also paste
  Cloudflare's whole `cloudflared service install <token>` command.

## 0.1.2 — 2026-09-29

- Pairing with the native iPhone app now works with the desktop app: the host speaks
  the sealed QR pairing and per-device end-to-end streams the iPhone app uses (0.1.1
  and earlier only understood the old format, so the app failed with
  `invalid_request`).
- The pairing link for a Wi-Fi-only setup now uses `http://` instead of `https://`.

## 0.1.1 — 2026-09-29

- Chief of Staff spawn decisions: when Jev is very confident a task needs a new Bot,
  a borderline "an existing Bot could do this" score no longer vetoes the spawn.
- New per-Bot option (Profile) to lift the per-run cost/token cap for that Bot's
  routine runs, so long routines are not cut off mid-task. Off by default.
- A turn that finishes on a tool call without a closing message now shows a
  fallback summary line instead of looking empty.
- Auto routing tells Jev which engine a Bot is already using, so follow-ups like
  "continue" stay on the same engine and keep their context.

## 0.1.0 — 2026-09-27

First public preview of OpenBot.

- Manage persistent Claude Code and Codex Bots in a local-first desktop chat.
- Delegate work through a Chief of Staff and review gated actions with approval
  cards.
- Configure routines, connected tools, and optional phone pairing.
- Let Bots use a Docker-backed Linux desktop with live view and screen takeover.
- Use your own provider accounts and keys; OpenBot ships without bundled
  credentials or a hosted backend.

This preview ships unsigned installers. macOS, Windows, and Linux may show a
security prompt during installation. Real-provider and remote-access combinations
are still receiving manual testing.
