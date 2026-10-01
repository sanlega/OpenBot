# Plan: VM-first bots, loop-proof computer control, UX polish (2026-10-01)

Owner request: research the GrokBot clones and learn from them; bots must use the VM, not the
host; sign-ins must persist across bots; the Jev computer loop must stop looping; rename and
delete bots (the Chief keeps the context); a reset-conversations button with confirmation; a
polished product overall.

## Evidence (logs of 2026-09-30/10-01, `~/.openbot/logs/threads`)
- 36 computer tasks from one worker bot, 4 completed. Patterns:
  - scroll loops: 14 consecutive `scroll` steps with no reason (scrolling changes the
    observation, so the stall detector never fires);
  - click loops: 38 clicks on one Product Hunt page;
  - "describe / report what is on the page" goals: the loop has no way to read, so it scrolls
    until the step limit; the engine then starts a narrower task, again and again;
  - 6 x "Opening the page took too long": after typing into X's composer, navigating away
    raises a `beforeunload` dialog; CDP calls block forever (no per-call timeout, no dialog
    handling) until the 30 s deadline.
- The engine kept spawning tasks because `next` for escalated tasks says "do not give up,
  steer with a different approach" and it has no direct way to look at or click the page.

## Competitors (2026-10-01)
- x.ai Grok Bot: every bot shares one persistent cloud computer (files, browser, logins);
  the bot works *on* that machine.
- Rakazo (elie222/rakazo, 3.2k stars): agent tools are sandbox tools only (shell, files,
  browser); browser via `browser_navigate` / `browser_snapshot` (page text + up to 80 refs) /
  `browser_act`; stale refs rejected; failed actions report progress and are never replayed;
  terminal + file browser in the Computer view; per-bot Chrome profiles.
- OpenMausBot (3.8k stars): approval levels mapped to native engine modes; a Chief with Full
  access passes it to the work it delegates; per-bot MEMORY.md with a journal and undo;
  team templates; right-click bot menu (pin, rename, duplicate, hide, delete).
- open-dots, akeru-bot, botato: smaller; nothing we lack beyond the above.

## Tasks
- [x] T1 CDP robustness: per-call timeout, auto-accept `beforeunload`/alert dialogs, a
      navigation that times out still continues if the page is there.
- [x] T2 Fast loop anti-loop: repeated-action and revisited-state detection, scroll budget per
      page, click budget per element, a no-progress budget; escalations say why and what the
      page shows. Tests reproduce the logged loops.
- [x] T3 Read goals: a goal that only asks to read/report finishes at once with the page text.
- [x] T4 Direct browser tools for the engine (`browser_open`, `browser_read`, `browser_click`,
      `browser_type`, `browser_key`, `browser_scroll`) on the bot's VM screen, refs from the
      last read, stale refs rejected, broker checks. `computer_task` stays for longer flows.
- [x] T5 VM-only bots: no host shell/files. Claude `--tools` without Bash/Edit/Write/Read...;
      Codex features `shell_tool`/`unified_exec`/browser/computer off; OpenBot MCP gives
      `vm_shell`, `vm_read_file`, `vm_write_file`, `vm_list_files` in the container. ACP engines:
      decide (fence or refuse VM-only).
- [x] T6 Shared sign-ins verified live (LinkedIn-style flow across two bots, after takeover);
      fix what fails.
- [x] T7 Bots: rename; delete with confirmation, the Chief keeps a summary of what the bot did.
- [x] T8 Settings: reset conversations (with confirmation), also per bot "clear chat".
- [-] T9 Delegated permission: dropped for now; since D-028 new Bots are Full by default.
- [x] T10 UX pass in the real app (screenshots), fix what looks off.
- [ ] T11 Full pipeline, live replay, release (owner's OK for publishing).

## Outcome (2026-10-01)
All done except T9 (dropped) and T11's release, which waits for the owner. Also done on the way:
replies keep only the text after the last tool call; long vm_shell output goes to
`/workspace/.tool-output`; GitHub CLI in the image; VM-only Bots are routed to Claude/Codex; a
sign-in race (browser not up yet) fixed; Chief-created slugs unique; activity labels for the new
tools; profile computer choice explained. Verification: unit 1251, E2E 23/23, lint 0 errors,
format, mh check, live vm 11/11, vmbot Claude/Codex 11/11, drive variant c.
