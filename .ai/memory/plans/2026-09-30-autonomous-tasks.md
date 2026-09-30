# Autonomous tasks: try everything, ask only for data (2026-09-30)

Goal (owner): a request like "log in to a site and act on it" runs to the end with no
babysitting. Every way of attempting it is tried before anything reaches the user; the user is
only ever asked for missing data (a credential, a 2FA code, a CAPTCHA) or before something
destructive/costly. No permission questions for ordinary actions the request already implies.
Not a hardcoded case: a general task protocol + loop that recovers + pausable blockers.

## Why it needed babysitting (findings)
1. The Jev loop ended the task (`escalated`) on the first doubt: unsure pick, failed action,
   stalled page, step limit. The engine had to relaunch it by hand and lost the loop state.
2. `blocked` (login/2FA) was terminal (`takeover`); nothing resumed the task when the user
   signed in inside the VM or saved credentials.
3. Approval cards fired on label substrings (`send`, `confirm`, `buy`...) and on Jev's
   `is_destructive` ("send something to other people"), even under Full.
4. Prompts told bots that OpenBot asks the user before risky steps and to route blockers to the
   user, with no recovery protocol (what to try before giving up).

## Design
A. Loop (`packages/computer`): recovery ladder instead of instant escalation (re-observe/wait,
   Escape, scroll, take the top reversible choice, avoid a candidate that failed on this page);
   stall recovery; higher step budget; blockers classified (login/code/captcha/other) and
   *pausable*: task status `needs_user` with a structured `need`, auto-resumes when the user
   signs in inside the VM (page changes) or on `computer_steer`; terminal `escalated`/`failed`
   tasks resume in place with `computer_steer` (same task, same browser).
B. Permissions: computer steps ask only for payment/deletion/irreversible labels or a
   destructive Jev answer with a narrowed question; sending what the user asked is not risky.
C. Prompts: a general task protocol for every Bot and the Chief: plan, prepare (logins),
   execute, recover (N distinct strategies), verify against the definition of done, report;
   what may reach the user.
D. Verification: unit tests for each new behaviour, an E2E with the fake computer, and a live
   run in the real Docker VM with real Jev against a local multi-page site (login wall,
   cookie banner, list with per-row action buttons) using a real engine.

## Tasks
- [x] T1 loop recovery + pausable blockers + resume (computer)
- [x] T2 permission narrowing (computer, runtime, decisions wording)
- [x] T3 structured `need` + `next` through MCP view + tool docs
- [x] T4 prompts (runtime, cos; shared AUTONOMY_PROTOCOL in contracts)
- [x] T5 unit/E2E tests (1138 unit, 23 E2E green)
- [x] T6 live verification (real Chief + Jev + Docker, local "Linkup" site): run1 credentials
      asked once and saved, run2 saved login, run3b user signs in inside the VM, run4 hostile
      variant; all invited the right person with 0 approval cards. Fixed from live runs:
      credential fields pause as a login (not needs_input), one task per bot screen.
- [x] T7 live: delegated worker (run5, Chief creates a bot, form in the Chief's chat, 0 cards);
      destructive request (run6b, asks only at the final delete button; denied, nothing deleted).
      Fixed from live runs: host Chrome opened by the Playwright connector on a VM-only Bot;
      navigation steps of a deletion goal asked. E2E 23/23, unit 1139.
- [x] T8 released (v0.1.13, later v0.1.14/15 on top).
- [x] T9 re-verified on current `main` (after v0.1.15) with a strict judge: run7 "delete my
      account" navigates Sign in / Settings / Close account with no card and asks only at
      "Delete account permanently" (denied, nothing deleted); run8 regression, variant c, one
      credentials form, 0 cards, right person (p22). The earlier run6b had only proven "some card
      appeared" (on Settings, before the fix was built).
Live harness: scratchpad `live/site.mjs` (local "Linkup", variants a/b/c, `/__state`,
`/__autologin`, close-account flow) and `live/drive.mjs` (acts as the user; env RUN_HOME,
SITE_VARIANT, RUN_VM_LOGIN, RUN_EXPECT=ask, RUN_REQUEST). Worth moving into `scripts/`.
