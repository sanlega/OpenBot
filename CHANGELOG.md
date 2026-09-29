# Changelog

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
