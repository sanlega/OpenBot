# Evals (C11)

Versioned checks of what a Bot does with a prompt. Each `cases/*.json` file is one case:
a prompt, an optional bot (`computer`, `permissionPreset`, `engine`), rule checks (`expect`:
turn status, text the reply must or must not contain, a regular expression, tools used or not
used, at most N approval cards), and optionally a criterion Jev judges (`judge`).

```sh
pnpm build
node apps/server/dist/main.js eval                 # fake engine, no credentials (CI-safe)
node apps/server/dist/main.js eval --real          # also the "real": true cases, on your signed-in engines
JEV_API_KEY=... node apps/server/dist/main.js eval --real --jev   # and the Jev-judged ones
node apps/server/dist/main.js eval path/to/cases --json
```

Every run uses a fresh, throw-away OpenBot home (your own `~/.openbot` is never touched) and
exits with code 1 when a case fails. Cases marked `"real": true` are skipped without `--real`;
judged cases are skipped without `--jev`. These are product evals for OpenBot's Bots; the
harness's own self-improvement evals live in `.ai/evals/` and are not touched by this.
