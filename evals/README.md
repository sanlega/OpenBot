# Evals (C11)

Versioned checks of what a Bot does with a prompt. Each `cases/*.json` file is one case:
a prompt, an optional bot (`computer`, `permissionPreset`, `engine`), rule checks (`expect`:
turn status, text the reply must or must not contain, a regular expression, tools used or not
used, at most N approval cards), and optionally a criterion Jev judges (`judge`).

```sh
pnpm build
pnpm eval                                          # fake engine, no credentials (CI-safe)
node apps/server/dist/main.js eval --real          # also the "real": true cases, on your signed-in engines
JEV_API_KEY=... node apps/server/dist/main.js eval --real --jev   # and the Jev-judged ones
node apps/server/dist/main.js eval path/to/cases --json
```

`"fakeOnly": true` cases use the fake engine's `@tool` directives and are skipped with `--real`.

Every run uses a fresh, throw-away OpenBot home (your own `~/.openbot` is never touched) and
exits with code 1 when a case fails. Cases marked `"real": true` are skipped without `--real`;
judged cases are skipped without `--jev`. These are product evals for OpenBot's Bots; the
harness's own self-improvement evals live in `.ai/evals/` and are not touched by this.

A `--real` run uses its own virtual machine (container `openbot-desktop-eval`, ports 8807 and
6100, volume `openbot-browser-eval`), never the installed app's, and removes the container at the end.
