# VM-first bots, loop-proof computer control, bot management UX

- **Fecha**: 2026-10-01 03:05
- **Agente**: claude
- **Rama**: sanlega/add-local-and-cli @ 604b161

## Done
- D-033: VM-only bots (computer docker) have no host shell/files/browser (Claude --tools, Codex
  features off, broker backstop, auto routing only to Claude/Codex); vm_shell/vm_*_file through
  a new daemon /exec; browser_read/click/type/key/scroll with refs and page text.
- Jev fast loop guards (repeats, scroll budget, revisited states, no progress, read-only goals,
  slow navigation); CDP call timeouts and JS dialogs answered.
- Shared sign-ins: race fixed (sync waited for the browser), verified on a real site and across
  a new container.
- Replies are the text after the last tool call; long shell output spilled to a file.
- UX: sidebar menu (rename inline, clear chat, delete with confirm), Settings > Data clear all,
  Chief keeps removed bots in its prompt, profile computer choice explained, activity labels.
- Research: Grok Bot box + clones in .ai/resources/2026-10-01-grok-bot-box-and-clones.md.
- Verified: unit 1251, E2E 23/23, lint 0 errors, format, mh check; live vm 11/11, vmbot
  Claude 11/11 and Codex 11/11, drive variant c.

## Pending
- Release v0.1.17 needs the owner's OK; the desktop image must be republished (the /exec
  endpoint and gh live in it).
- Candidates: visible todo list per turn, box self-check in Settings > Computer, terminal/file
  panel on the Computer tab, first-run greeting, per-bot memory file, ACP engines in the VM.

## Retro
- Worked: reading the real logs first (the loops were obvious there), building a second test
  container next to the installed app, behavioural probes of engine sandboxes.
- Failed: a local-only live check hid the sign-in race; python heredocs mangled TS escapes twice.
- Harness: live scripts now cover the VM; a CI-able fake for /exec exists in unit tests only.
