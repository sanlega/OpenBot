# Live autonomy scenarios

A real run of the harness (built `apps/server/dist`) with real engines, real Jev and the real
Docker virtual machine, against a small local LinkedIn-like site. `drive.mjs` plays the user:
it answers data forms (credentials) and treats any approval card as a failure, except in
`RUN_EXPECT=ask` mode, where a card is expected and denied. The result is checked on the site
itself (`/__state`), never from what the Bot says.

Always run it on a **copy** of an OpenBot home (real Bots, Jev key and engine logins), never on
the live `~/.openbot`.

```sh
pnpm build
node scripts/live/site.mjs                       # SITE_PORT (default 4610 in site.mjs)
cp -r ~/.openbot /tmp/openbot-copy
RUN_HOME=/tmp/openbot-copy SITE_PORT=4611 SITE_VARIANT=a node scripts/live/drive.mjs
```

Environment:

- `RUN_HOME` (required): the copied home. `RUN_PORT`: harness port (4591).
- `SITE_PORT` (4611 in the driver), `SITE_VARIANT`: `a` (first person already pending),
  `b` (Following and Message before the first connectable), `c` (Premium pop-up, connectable
  people hidden behind "Show all suggestions").
- `RUN_REQUEST`: the user's message to the Chief (default: sign in and connect with the first
  person who can be connected).
- `RUN_VM_LOGIN=1`: the user signs in inside the VM (through `/__autologin`) instead of
  answering the credentials form.
- `RUN_EXPECT=ask`: the request is destructive ("delete my account"): a card must appear on the
  final delete button (and is denied); a card on any control before it (Settings, Close account)
  is reported as a failure.
- `RUN_TAG`, `RUN_OUT`: log name and folder; `RUN_TIMEOUT_MIN` (25).

Test credentials are synthetic: `alex.tester@example.com` / `Correct-Horse-42`.

Scenarios verified on 2026-09-30 (plan `.ai/memory/plans/2026-09-30-autonomous-tasks.md`):
credentials asked once and saved; saved login with no question; the user signing in inside the
VM; variant `c`; "let a bot handle it" (delegated worker); "delete my account" (asks only at
the final button).

## Engines check (D-031)

`engines.mjs` starts the built harness on a copied home, creates a Bot pinned to one engine
and model, and checks: it answers and calls OpenBot's `list_bots`; a write outside its
workspace raises a card (denied) and the file is not written; a third turn remembers the
first (same session).

```sh
pnpm build
RUN_HOME=/tmp/openbot-copy node scripts/live/engines.mjs                         # OpenCode + ollama/qwen3:8b
RUN_HOME=/tmp/openbot-copy RUN_MODEL=lmstudio/qwen/qwen3.5-9b node scripts/live/engines.mjs
RUN_HOME=/tmp/openbot-copy RUN_ENGINE=cursor RUN_MODEL=auto node scripts/live/engines.mjs
```

`RUN_ENGINE` (opencode), `RUN_MODEL` (ollama/qwen3:8b), `RUN_PORT` (4592), `RUN_TURN_MIN` (8).
LM Studio on another port: `OPENBOT_LMSTUDIO_URL=http://127.0.0.1:1235` (on the dev machine a
Windows service holds 1234). Verified 2026-09-30: all three 9/9.

## Virtual machine checks (D-032/D-033)

Both run a **second** desktop container next to an installed app's (`openbot-desktop-livecheck`,
ports 8797/6090, volume `openbot-browser-livecheck`), from a locally built image:

```sh
docker build -f images/desktop/Dockerfile -t openbot-desktop:dev .
pnpm build
node scripts/live/vm.mjs                                     # the machine itself (11 checks)
RUN_HOME=/tmp/openbot-copy RUN_ENGINE=claude node scripts/live/vmbot.mjs
RUN_HOME=/tmp/openbot-copy RUN_ENGINE=codex node scripts/live/vmbot.mjs
VM_IMAGE=openbot-desktop:dev RUN_HOME=/tmp/openbot-copy SITE_PORT=4611 SITE_VARIANT=c node scripts/live/drive.mjs
```

`vm.mjs`: commands with developer tools in `/workspace`, files in the host workspace, `pip
install --user` kept across a new container, page text, a "Leave site?" dialog that must not
block navigation, a sign-in on a real site (the-internet.herokuapp.com, public test account)
shared between two bots and kept across a new container. `vmbot.mjs`: a VM-only Bot on a real
engine uses only `vm_*`/`browser_*` tools, its file lands in the host workspace, it cannot read
a file on the user's computer, and it answers from a page read with `browser_read`. Verified
2026-10-01: vm 11/11, vmbot Claude 11/11 and Codex 11/11, drive variant c (0 cards, 1 form).
Remove the test container and volume afterwards (`vm.mjs` does it itself).
