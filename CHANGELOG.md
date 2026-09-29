# Changelog

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
