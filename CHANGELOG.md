# Changelog

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
