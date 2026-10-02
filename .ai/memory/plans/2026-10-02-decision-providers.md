# Plan: swappable decision providers (Laya, ImaJev) next to Jev

_Owner's request (2026-10-02): add the 4 recommendations of
`.ai/resources/2026-10-02-imajev-laya-decision-models.md` to the backlog and implement them with
the usual workflow (plan, small verified steps, live checks, reviewer agents, release and a check
of the installed app, by computer control if needed)._

Jev stays the default. Everything here is opt-in, except recording what each decision saw.

## Items (mark when implemented AND tested)

**V1 · Decisions keep what they saw**
- [ ] Migration 0008: `decisions.request` (JSON: `{ state, questions }`, redacted, capped at 32 KB).
- [ ] The decision log records it for every provider (Jev, local, fallback). Secrets are redacted
      with the same patterns as the chat error view, plus typed secrets the computer loop masks.
- [ ] Retention: a request older than 30 days is cleared at start-up and daily; the row stays.
- [ ] Settings > Jev has "Keep what each decision saw (30 days)", on by default. When it is off,
      nothing is stored.

**V2 · Compare providers on recorded decisions**
- [ ] `openbot decisions compare --url <jev-compatible URL> [--key K] [--purpose p] [--limit n]
      [--json]` replays stored requests against another provider. It reports, per purpose:
  - agreement with the recorded answer (choice and noul ≥ 0.5);
  - mean confidence and latency;
  - questions the provider refused (too many options, too long).
- [ ] It never writes to the database and never calls the TypeSafe API.

**V3 · Choose the decision provider (Settings > Jev)**
- [ ] Settings value `decisionProvider`:
  - `mode`: `jev` (default), `local` or `hybrid`;
  - `localUrl` and optional `localKey` (stored in the vault);
  - `visionUrl`, optional;
  - per-provider bands: `local.autoMin` and `local.confirmMin`.
- [ ] `local`: every decision goes to the local server and no TypeSafe key is needed (offline
      mode). If the server is down, the conservative fallback applies.
- [ ] `hybrid`: local only for questions that suit a small model:
  - every question is a `noul`, a `score` or a `choice` with ≤ 8 options;
  - the state is ≤ 3,000 characters;
  - the purpose is not `computer`.

  Everything else goes to Jev. A local error or timeout retries on Jev.
- [ ] Provider label `local` (contracts). The computer loop and the gates treat `jev` and `local`
      alike as real model answers, using that provider's bands.
- [ ] A "Check connection" button runs a probe decision and shows the model name and latency.
- [ ] Audit shows each decision's provider.

**V4 · Visual check (ImaJev-compatible)**
- [ ] The daemon gets `GET /screenshot?botId&display`: a JPEG of the bot's page, scaled to at most
      400,000 pixels. It needs the screen lease (B4).
- [ ] `Screen.screenshot?()` (contracts); the docker screen implements it.
- [ ] Goal check: when `visionUrl` is set and the text check didn't confirm the goal, the fast loop
      sends the screenshot with `goal_met` and with `wall` ("does the screen show a sign-in page,
      CAPTCHA or bot check?").
  - A visual `goal_met` yes at ≥ 0.9 ends the task as done.
  - A visual wall at ≥ 0.9 pauses the task as `needs_user` (existing path).
- [ ] Vision failures never stop a task: the loop carries on as today.

## Verification
- **Unit tests:**
  - redaction and caps;
  - retention;
  - hybrid routing rules;
  - fallback to Jev;
  - provider bands;
  - the compare report;
  - daemon `/screenshot` lease and size;
  - the visual goal check with a fake vision server.
- **E2E:** Settings > Jev provider change, and the Check connection button against the fake Jev
  server.
- **Live, on this machine (RTX 4080 SUPER, 16 GB):**
  - `laya-serve` on the GPU: hybrid and local mode with a real Chief on a copy of the real home;
  - `openbot decisions compare` against Laya, on decisions recorded by a live run with Jev;
  - ImaJev 4B on the GPU: a visual goal check on a real page in the VM.
- **Reviewers:** a functionality agent and a design agent, until both give 10/10.
- **Release v0.1.21** (migration, plus a daemon change, so the image is republished). Install it
  and check the installed app by computer control:
  - Settings > Jev, provider and connection check;
  - Audit shows providers;
  - a Chief request still works on Jev.

## Risks
- Stored requests hold page text and user messages. They stay in the local database, are
  redacted, kept 30 days, can be switched off, and are covered by Reset.
- Confidence differs between models, so local providers get their own bands. The defaults are
  stricter (auto ≥ 0.95, confirm ≥ 0.6) until the compare tool says otherwise.
- ImaJev reads English only. The goal is sent as written, and the note says so.
