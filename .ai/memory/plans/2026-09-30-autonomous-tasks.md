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
- [ ] T1 loop recovery + pausable blockers + resume (computer)
- [ ] T2 permission narrowing (computer, runtime, decisions wording)
- [ ] T3 structured `need` through MCP view + tool docs
- [ ] T4 prompts (runtime, cos)
- [ ] T5 unit/E2E tests
- [ ] T6 live verification loop, fix what it finds
- [ ] T7 memory, release
