# Plan: Settings action to get/reset the Computer desktop image

- **Fecha**: 2026-09-28 · **Autor**: Claude · **Estado**: hecho
- **Petición original**: "A lo mejor añadir una opcion en la config que permita construir
  el contenedor, y resetearlo en caso de que quieran crearlo de 0" — found via a gap this
  session: `DockerProvider.ensureStarted()` calls `docker.createContainer()` on
  `openbot/desktop:latest` with no pull/build step, and the image isn't published
  anywhere; `POST /api/computer/start` doesn't catch the resulting error, so it
  currently reaches the user as a raw Docker error instead of guidance.

## Objetivo

A user who wants a bot to use the Computer feature can get the desktop image ready
(download it) and, if it's ever in a bad state, wipe it and get a clean one — from
Settings, without opening a terminal or knowing `docker build`/`docker pull` syntax.

## Alcance

**Incluye**
- CI publishes the `images/desktop` Dockerfile as `ghcr.io/sanlega/openbot-desktop`
  on release tags (`v*`), tagged `latest` + the release tag (D-020).
- `DockerProvider`'s default image reference points at that GHCR image.
- Backend: image status/build/reset endpoints and events so the UI can show live
  progress instead of blocking on a single request.
- `POST /api/computer/start`'s existing raw-error gap is fixed as part of this work
  (same file, same root cause) so a missing image always reads as guidance, not a stack
  trace — whether the user hits it from a bot's Computer tab or from Settings.
- UI: a new Settings section to see the image's state and trigger get/reset, plus the
  Computer tab pointing there when it hits a missing-image error.
- A dev-checkout convenience: if the maintainer is running from a git checkout (the
  monorepo source is reachable next to the running package), "get the image" can build
  locally from `images/desktop/Dockerfile` instead of pulling — mainly so contributors
  can test Dockerfile changes without pushing to the registry.
- Mock server + tests updated to match (project convention: UI mock server mirrors the
  real API).

**Fuera de alcance**
- Making the GHCR package public is a manual one-time GitHub UI step the owner does
  after the first CI publish (tracked as a risk below), not part of this plan's tasks.
- Multi-arch (`arm64`) desktop images — the Dockerfile and CI job stay `amd64`-only,
  matching what exists today; cross-arch is a separate follow-up if ever needed.
- Any change to the Computer *task* execution loop (Jev step decisions, live view,
  takeover) — this plan only touches how the container image is obtained/reset.
- Bundling the monorepo source into the Electron installer (rejected in D-020).

## Criterios de aceptación

1. Dado Docker Desktop running and the image not present locally, cuando the user opens
   Settings > Computer, entonces they see "Not downloaded" and a "Get desktop image"
   button (no terminal needed).
2. Dado the user clicks "Get desktop image", cuando the pull is in progress, entonces
   the button shows a busy state and the section reflects "Downloading…" live (via a
   WS event), without the user needing to reload the page.
3. Dado the pull finishes, cuando it succeeds, entonces the state changes to "Ready" and
   starting a bot's Computer tab no longer fails with a missing-image error.
4. Dado the image is present (possibly stale/corrupt), cuando the user clicks "Reset"
   and confirms, entonces the existing `openbot-desktop` container is stopped/removed,
   the image is removed, and a fresh pull starts automatically — ending at "Ready" with
   no other manual step.
5. Dado a bot's Computer tab calls `/api/computer/start` while the image is missing,
   cuando the request fails, entonces the UI shows a specific message pointing to
   Settings > Computer instead of a raw Docker/HTTP error string.
6. Dado a second "get image" request arrives while one is already in progress, cuando
   the route handles it, entonces it responds `409` instead of starting a second
   concurrent pull/build.
7. Dado a maintainer running from a git checkout with `images/desktop/Dockerfile`
   reachable on disk, cuando they choose "Build from source" (a secondary option, not
   the default), entonces the image is built locally instead of pulled, without
   requiring network access to GHCR.
8. Dado the CI release workflow runs on a `v*` tag, cuando the new publish job runs,
   entonces `ghcr.io/sanlega/openbot-desktop:latest` and `:<tag>` are pushed.

## Diseño

### Componentes afectados
- `packages/contracts/src/computer.ts` (or a new `computer-image.ts`) + `events.ts` +
  `fixtures/events/`.
- `packages/computer/docker/src/docker-provider.ts` (default image, `DockerEngine`
  surface) and a new `image-manager.ts` (status/pull/build/reset orchestration,
  progress callback).
- `packages/core/src/http/routes/computer.ts` (three new routes + the `start` fix),
  wired through `CoreContext`/event bus like every other route.
- `apps/server/src/providers.ts` (pass the GHCR default image explicitly, or just rely
  on the new `DEFAULT_IMAGE`).
- `packages/ui/src/components/settings/SettingsView.tsx` (new section) +
  `packages/ui/src/components/computer/ComputerPanel.tsx` (missing-image message) +
  `packages/ui/src/api/types.ts` / `adapters.ts` + `packages/ui/src/mock/mock-server.ts`.
- `.github/workflows/release.yml` (new job, `permissions.packages: write`).
- `images/desktop/README.md` (document the registry image alongside the manual build).

### Cambios de datos / contratos
- New `EventType` member: `"computer.image_status"`. Payload:
  `{ state: "missing" | "pulling" | "building" | "ready" | "error"; tag: string;
  source?: "registry" | "local"; detail?: string }`.
- New route contracts (documented in the routes themselves, no separate schema package
  changes needed beyond the event/status shape above):
  - `GET /api/computer/image` → current `ComputerImageStatus` (as above, plus
    `localBuildAvailable: boolean`).
  - `POST /api/computer/image/build` body `{ source?: "registry" | "local" }`
    (default `"registry"`) → `202 { state }` or `409` if already running or `400` if
    `source: "local"` isn't available or the provider isn't `"docker"`.
  - `POST /api/computer/image/reset` body `{ removeImage?: boolean }`
    (default `true`) → `202 { state: "missing" }`, then the same async flow as build.
  - `POST /api/computer/start` unchanged contract, but on a missing-image failure now
    replies `409 { error: "image_missing", reason: "..." }` instead of `500`.

### Flujo principal
1. Settings mounts, calls `GET /api/computer/image`, subscribes to
   `computer.image_status` over the existing WS bus (same subscribe path every other
   live view uses).
2. User clicks "Get desktop image" → `POST /api/computer/image/build` → route publishes
   `computer.image_status: pulling` immediately, kicks off `image-manager.pullImage()`
   in the background (dockerode `docker.pull()` + `modem.followProgress`), publishes
   `ready` or `error` on completion. No chunked HTTP response needed — this matches
   the existing convention ("state changes are published as events on the bus").
3. "Reset" (after inline confirm, same UX pattern as `DevicesRemoteView.tsx`) →
   `POST /api/computer/image/reset` → route stops/removes the `openbot-desktop`
   container if present, removes the image if `removeImage`, publishes `missing`, then
   immediately calls the same pull/build path as step 2.
4. A bot's Computer tab calling `/api/computer/start` while the image is missing now
   gets a `409 image_missing` it can render as "Open Settings > Computer to download
   it" instead of the current generic Docker-error string.

### Errores y casos límite
- Docker daemon itself unreachable (`isDockerAvailable()` false): both new routes
  return `400 { error: "docker_unavailable" }` before touching the image; UI shows the
  same "Docker Desktop isn't running" guidance already used elsewhere.
- Registry pull unauthorized (GHCR package still private — see Risks): surfaced as
  `computer.image_status: error` with a `detail` naming the cause; UI shows it verbatim
  plus a hint to check the package's visibility (only realistically hit by the
  owner/maintainer before the one-time visibility flip, not by end users after that).
- Reset requested while no container/image exists: treated as a no-op stop/remove
  (idempotent), then proceeds straight to pull — never errors just because there was
  nothing to clean up.
- Two browser tabs both trigger "get image": the second `POST` gets `409`; both tabs
  still converge on the same `computer.image_status` events since they're on the same
  WS bus.
- `source: "local"` requested but no `images/desktop/Dockerfile` reachable from the
  running process (packaged installs): `400`, UI never shows that option unless
  `localBuildAvailable` was true in the last status.

### Compatibilidad / migración
- No stored-data migration. `DEFAULT_IMAGE` changes from `openbot/desktop:latest` to
  the GHCR reference; anyone who already built the old local tag keeps it in their
  Docker cache (harmless, just unused going forward) unless they reset.
- `EventType` enum gains one member — additive, no existing event payload changes.

### Alternativas descartadas
- Bundling the monorepo into the installer so the packaged app can build from source —
  rejected in D-020 (bigger installer, fragile first run, no benefit over a prebuilt
  registry image).
- Streaming per-layer Docker pull progress lines into the UI — adds noisy, low-value
  detail for a ~1-2 minute operation; a single state (`pulling`/`building`) plus a
  spinner is enough, matches this plan's smaller footprint. Can be added later without
  breaking the contract (an optional `detail` field already exists for a short status
  line if `image-manager.ts` wants to report e.g. "Downloading layer 3/9" without a
  contract change).

## Tareas

| # | Tarea | Archivos probables | Verificación | Depende de | Paralelo |
|---|-------|--------------------|--------------|------------|----------|
| 1 | Add `computer.image_status` event type + fixture; add `ComputerImageStatus` types | `packages/contracts/src/{computer,events}.ts`, `packages/contracts/fixtures/events/` | `pnpm --filter @openbot/contracts build && pnpm --filter @openbot/contracts test` | — | sí (con T5) |
| 2 | `DockerEngine`/`image-manager.ts`: image status, pull (GHCR), reset (stop+remove container/image), default image constant updated | `packages/computer/docker/src/{docker-provider,image-manager}.ts` | `pnpm --filter @openbot/computer-docker test` (mocked `DockerEngine`, no real Docker) | T1 | no |
| 3 | Dev-checkout local-build convenience: detect `images/desktop/Dockerfile` from the running package, shell out to `docker build` when `source: "local"` | `packages/computer/docker/src/image-manager.ts` (or a small `repo-source.ts`) | Unit test with a temp dir fixture standing in for "repo root"; manual check `localBuildAvailable` is true when run via `pnpm --filter @openbot/server dev serve` from this checkout | T2 | sí (con T4) |
| 4 | Core routes: `GET/POST /api/computer/image`, `POST /api/computer/image/reset`, and the `POST /api/computer/start` try/catch fix (`409 image_missing`) | `packages/core/src/http/routes/computer.ts` | `pnpm --filter @openbot/core test` (new route tests: happy path, 409 concurrent, 400 docker-unavailable, `start` missing-image fix) | T2 | sí (con T3) |
| 5 | `apps/server/src/providers.ts` passes/confirms the GHCR default image | `apps/server/src/providers.ts` | `pnpm --filter @openbot/server test` (existing `providers.test.ts` asserts `computerProvider?.id === "docker"`; extend to assert the image tag) | T2 | sí (con T1) |
| 6 | UI: `api/types.ts` + `adapters.ts` for the image status shape; mock server routes for the three new endpoints (simulated state machine) | `packages/ui/src/api/{types,adapters}.ts`, `packages/ui/src/mock/mock-server.ts` | `pnpm --filter @openbot/ui typecheck && pnpm --filter @openbot/ui test` | T4 | no |
| 7 | UI: Settings > Computer section (status pill, get/reset with inline confirm, live WS updates) | `packages/ui/src/components/settings/SettingsView.tsx` (+ a new `ComputerImageCard.tsx` if it doesn't fit inline) | New component test + manual check in `pnpm --filter @openbot/server dev serve` with Docker running | T6 | sí (con T8) |
| 8 | UI: `ComputerPanel.tsx` shows a specific message + link on `409 image_missing` instead of the generic Docker-error string | `packages/ui/src/components/computer/ComputerPanel.tsx`, `ComputerPanel.test.tsx` | Existing + new `ComputerPanel.test.tsx` cases pass | T6 | sí (con T7) |
| 9 | CI: publish job on `.github/workflows/release.yml` (`packages: write`, `docker/login-action`, `docker/build-push-action`, tags `latest` + `${{ github.ref_name }}`) | `.github/workflows/release.yml` | Can't run a real tag push locally; verify with `act`-style dry read of the YAML (`actionlint` if available) and a careful manual review against the existing `package`/`publish` jobs' style | — | sí (independiente) |
| 10 | Docs: `images/desktop/README.md` documents the GHCR image + the one-time visibility step; `STATE.md` updated | `images/desktop/README.md`, `.ai/memory/STATE.md` | Read-through; commands in the doc actually match T9's tags | T9 | no |

Avance:
- [x] T1
- [x] T2
- [x] T3
- [x] T4
- [x] T5
- [x] T6
- [x] T7
- [x] T8
- [x] T9
- [x] T10

## Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| GHCR package inherits the repo's current private visibility (STATE.md: kept private pending a GitHub Support ref-purge), so `docker pull` fails for everyone but the owner until it's flipped public | alta | alto | T9/T10 call this out explicitly; `image-manager.ts` surfaces the auth failure as a clear `error` detail rather than a generic failure, so it's diagnosable; owner does the one-time visibility switch after the first successful publish |
| A pull/build genuinely takes long (slow connection, cold Docker cache) and the user thinks it's stuck with no per-layer feedback | media | bajo | The single-state design was a deliberate tradeoff (see Alternativas descartadas); a short `detail` string is already in the contract if this turns out to matter after real use |
| Two independent "stop the container" paths exist (the existing 30-minute idle stop in `DockerProvider.scheduleIdleStop()` and the new reset flow) could race if a reset lands mid-idle-stop | baja | medio | `image-manager.ts`'s reset explicitly cancels/coordinates with `DockerProvider`'s idle timer (or reset always goes through `DockerProvider`'s own `stop()`, never a second code path) — call this out in T2's implementation, add a regression test |
| `docker build`'s dev-checkout convenience (T3) silently becomes the only path someone tests, and the registry path (the one real end users hit) bit-rots | baja | medio | T9's CI job is the only thing that exercises the registry path end-to-end before a real release; note in T10's docs that contributors should occasionally test `source: "registry"` too |

## Preguntas abiertas

- Should "Reset" default to also removing the image (`removeImage: true`), or just the
  container (keeping the cached image, re-pulling only if it's actually gone)? This
  plan defaults to "also remove the image" per the user's "crearlo de 0" phrasing, but
  it's slower (T4 can make it a checkbox next to the confirm instead of a fixed
  default if that's wrong).
- Do we want the CI publish job gated on the same manual approval other
  release/desktop-packaging steps get, or should it run unattended on every `v*` tag
  like the rest of `release.yml`? This plan assumes unattended, matching the existing
  jobs in that file.
