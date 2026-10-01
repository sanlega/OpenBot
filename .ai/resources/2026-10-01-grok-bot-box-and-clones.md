# Grok Bot's computer ("the box") and the open-source clones (2026-10-01)

Sources: a file dump of a Grok Bot box home directory the owner took from their own account
(kept outside this repo; it contains credentials and must never be copied here), x.ai/bot, and
the READMEs/docs of the clones. Only structure and behaviour are recorded here.

## How the Grok Bot box is built
- One Linux desktop per user (XFCE, Plank dock, Thunar, LibreOffice, Google Chrome), shared by
  every bot: "Isolation is per user, not per Grok Bot". Runs as a local Docker container in dev
  (`sand-box-*`) or a brokered pod in production; `/workspace` is the persistent scratch space.
- The agent harness runs *with the box as its machine*: its `shell`/`read` tools and the coding
  CLIs it drives (Claude Code via the SDK, Codex app-server daemon, Cursor agent) all run inside
  the box with cwd `/workspace`. The user's own computer is not involved.
- Main-agent tools seen in a transcript: `send_message` (the only way text reaches the user),
  `communicate_update` (progress), `update_todos` (a visible task list), `task` (subagents),
  `web_search`, `web_fetch`, `shell`, `read`, `get_mcp_tools` (connectors on demand), plus
  `Shell`/`Screenshot` on the box. Driving the GUI is delegated to **computerUse subagents**,
  each assigned its own window/display (`.sand-window-assignments.json`: agent id -> display
  2..14, with a token per agent).
- Browser: one `chrome-profile` with per-window forks (`Fork-6`, `Fork-8`, ...) seeded from a
  shared cookie file (`sand-data/chrome-cookie-seed.json`), launched only through a `box-chrome`
  launcher (a launch lock and count in the profile). Same idea as OpenBot's `SharedCookieJar`
  (D-032).
- `request_box_help`: hands the user a manual step (a login, a CAPTCHA) on the live desktop.
- `box-doctor`: a startup and on-demand self-check (machine-id, Chrome version, DNS/egress,
  clock, D-Bus), one PASS/FAIL line per check; logs under `/tmp` (start-desktop, x11vnc, novnc).
- Recovery in Settings > Computer: "Update Grok Bot's Computer" (fresh instance, keeps files and
  logins, installed software must be reinstalled; two-click confirm) and "Reset" (restore the
  last snapshot; last resort).
- UI: deleting an agent is a right-click "Delete" in the sidebar with a confirm (permanent, no
  archive); a per-agent info pane shows a live preview of its computer, its routines and its
  channels; per-agent settings hold avatar, name, title, description, notifications.
- A new agent gets a hidden first-run prompt: greet briefly, and if its description is an
  assignment, start it at once; otherwise learn what the user wants, one question at a time,
  and offer connector cards instead of describing setup.

## Clones (GitHub, 2026-10-01)
- Rakazo (elie222/rakazo, Apache-2.0, 3.2k stars): web + Electron + Expo; Team Computer shared
  by bots or Private Computer; agent tools are sandbox tools only (shell, files,
  `browser_navigate`/`browser_snapshot`/`browser_act` with refs; stale refs rejected; failed
  actions report progress and are never replayed); terminal and file browser docked over the
  live screen; per-bot Chrome profiles; Docker/E2B/Daytona/Box providers.
- OpenMausBot (milind-soni/OpenMausBot, Apache-2.0, 3.8k stars): local CLIs (claude, codex,
  grok) through one harness; approval levels mapped to native engine modes; a Chief with Full
  access passes it to delegated work; MEMORY.md per bot with a journal and undo; channels,
  team templates from one Markdown file, voice; Boat cloud computer or a local VM; Jev routing.
- open-dots (MIT, 4.9k), akeru-bot, botato, guaca: smaller prototypes.

## What OpenBot took from this (D-033 and after)
- Bots whose computer is the VM work inside it: no host shell/files; `vm_shell`/`vm_*_file`.
- Engine-driven browser tools with refs and page text, next to the Jev loop.
- Right-click delete with confirm; Chief keeps a note of removed bots.
- Candidates for later: a visible todo list per turn, a box self-check (`box-doctor`-style) in
  Settings > Computer with Update vs Reset, first-run greeting for new bots, delegated Full
  access, per-bot memory file, a terminal/file panel on the Computer tab.

## The box's /workspace (a second dump, same owner)
- Large tool results are spilled to `/workspace/agent-tools/<uuid>.txt` and read from there
  instead of filling the context.
- Bots browsed with Playwright MCP inside the box (`/workspace/.playwright-mcp`: accessibility
  snapshots with refs as `.yml`, plus screenshots), i.e. an engine-driven read-then-act browser,
  the approach of OpenBot's `browser_*` tools.
- Coding work was delegated to cloud coding agents (`cloud-agent-transcripts/bc-*`), issue by
  issue, with role prompts (foreman / builder / designer) kept in the workspace.
