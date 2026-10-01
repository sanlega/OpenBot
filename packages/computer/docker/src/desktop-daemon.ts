#!/usr/bin/env node
/**
 * HTTP control daemon for OpenBot desktop containers.
 * Observation: CDP DOM → CDP AX → AT-SPI → OCR (plan WS9).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cdpCookies, cdpStorage, DisplaySessionManager } from "./display-session.js";
import { createLiveViewUrl } from "./live-view-url.js";
import { defaultExecIdentity, runExec, type ExecRequest } from "./exec.js";
import { startPackageHelper } from "./apt-helper.js";
import { liveDoctorDeps, runBoxDoctor } from "./box-doctor.js";
import { TelemetryLog } from "./telemetry.js";
import { stripMeta } from "@openbot/computer/observation";
import type { Action } from "@openbot/contracts";

/**
 * What this daemon speaks. The app checks it: an older image (no screen leases, no doctor) is
 * reported as one to update instead of failing tool by tool.
 */
export const DAEMON_PROTOCOL = 2;

const PORT = Number(process.env.OPENBOT_CONTROL_PORT ?? 8787);
const MAX_SCREENS = Number(process.env.OPENBOT_MAX_SCREENS ?? 4);
const TOKEN = process.env.OPENBOT_CONTROL_TOKEN ?? randomBytes(16).toString("hex");
// The token is this daemon's own credential: no process it starts (the desktop, a bot's command)
// inherits it. Bots' commands also run as another user, who cannot read this process's memory.
delete process.env.OPENBOT_CONTROL_TOKEN;
const NOVNC_PORT = Number(process.env.NOVNC_PORT ?? 6080);
const TOKEN_FILE = "/tmp/openbot-vnc-tokens";
const liveTokens = new Map<string, { display: number; port: number; expires: number }>();
// Files the desktop writes into the shared workspace (downloads) must stay editable by the bots.
process.umask(0);

function persistLiveTokens(): void {
  writeFileSync(
    `${TOKEN_FILE}.next`,
    [...liveTokens].map(([token, entry]) => `${token}: 127.0.0.1:${entry.port}`).join("\n") + "\n",
    { mode: 0o600 },
  );
  renameSync(`${TOKEN_FILE}.next`, TOKEN_FILE);
}

// D-032: one set of sign-ins and one set of files for every bot. Browser profiles and the shared
// sign-ins live on the container's browser volume; downloads go to the bots' workspace.
const BROWSER_DIR = process.env.OPENBOT_BROWSER_DIR;
const WORKSPACE = process.env.OPENBOT_WORKSPACE_DIR ?? "/workspace";
const telemetry = new TelemetryLog(BROWSER_DIR ? join(BROWSER_DIR, "telemetry.ndjson") : undefined);
const identity = { ...defaultExecIdentity(), secrets: [TOKEN] };

/** Which bot holds each screen's control lease (B4): `/act` and `/observe` need it. */
const leases = new Map<string, Buffer>();
const displayOwner = new Map<number, string>();

const sessions = new DisplaySessionManager({
  maxScreens: MAX_SCREENS,
  ...(BROWSER_DIR
    ? {
        profileRoot: BROWSER_DIR,
        cookies: cdpCookies,
        cookieFile: join(BROWSER_DIR, "shared-cookies.json"),
        storage: cdpStorage,
        storageFile: join(BROWSER_DIR, "shared-storage.json"),
      }
    : {}),
  ...(existsSync(WORKSPACE) ? { downloadDir: join(WORKSPACE, "downloads") } : {}),
  onTelemetry: (event) => telemetry.record(event),
  onEvict: (display) => {
    for (const [token, entry] of liveTokens) {
      if (entry.display === display) liveTokens.delete(token);
    }
    persistLiveTokens();
    // The screen went to another bot: whatever the old one still runs cannot click on it.
    const owner = displayOwner.get(display);
    if (owner) leases.delete(owner);
    displayOwner.delete(display);
  },
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { detail: { error_type: "auth", message: "invalid token" } });
}

function sameSecret(given: string, expected: string | Buffer): boolean {
  const a = Buffer.from(given);
  const b = typeof expected === "string" ? Buffer.from(expected) : expected;
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The bot a request acts for, when it carries that bot's screen lease. */
function leaseHolder(req: IncomingMessage, botId: string): boolean {
  const lease = leases.get(botId);
  const given = req.headers["x-openbot-screen"];
  return Boolean(lease && typeof given === "string" && sameSecret(given, lease.toString("hex")));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>,
        );
      } catch (error) {
        reject(error);
      }
    });
  });
}

const execAsBox = (command: string) =>
  runExec(
    { command, timeoutMs: 20_000 },
    { cwd: existsSync(WORKSPACE) ? WORKSPACE : "/" },
    identity,
  );

// Nothing an individual request does may crash the desktop for every Bot.
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});

// Bots install system packages through this socket (images/desktop/box-apt.sh).
if (identity.uid !== undefined) startPackageHelper("/run/openbot/apt.sock");

const server = createServer(async (req, res) => {
  const auth = req.headers.authorization ?? "";
  if (!sameSecret(auth, `Bearer ${TOKEN}`)) return unauthorized(res);

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      maxScreens: MAX_SCREENS,
      protocol: DAEMON_PROTOCOL,
      screens: sessions.health(),
    });
  }

  if (req.method === "GET" && url.pathname === "/doctor") {
    try {
      const checks = await runBoxDoctor(
        liveDoctorDeps({
          runAsBox: execAsBox,
          screens: () => sessions.health(),
          workspace: WORKSPACE,
        }),
      );
      return json(res, 200, {
        ok: checks.every((c) => c.ok),
        checks,
        screens: sessions.health(),
        telemetry: telemetry.read(200),
      });
    } catch (error) {
      return json(res, 500, { ok: false, reason: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/telemetry") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 5_000);
    return json(res, 200, { events: telemetry.read(limit) });
  }

  if (req.method === "GET" && url.pathname === "/logs") {
    const botId = url.searchParams.get("botId") ?? "";
    return json(res, 200, { logs: sessions.logs(botId) });
  }

  if (req.method === "POST" && url.pathname === "/screens/lease") {
    const body = await parseBody(req).catch(() => ({}) as Record<string, unknown>);
    const botId = typeof body.botId === "string" ? body.botId : "";
    if (!botId) return json(res, 400, { ok: false, reason: "botId is required" });
    const lease = randomBytes(24);
    leases.set(botId, lease);
    return json(res, 200, { lease: lease.toString("hex") });
  }

  if (req.method === "POST" && url.pathname === "/screens/revoke") {
    const body = await parseBody(req).catch(() => ({}) as Record<string, unknown>);
    if (typeof body.botId === "string") leases.delete(body.botId);
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/observe") {
    const botId = url.searchParams.get("botId") ?? "unknown";
    if (!leaseHolder(req, botId)) return json(res, 403, { ok: false, reason: "no screen lease" });
    try {
      const mode = url.searchParams.get("mode") as "dom" | "ax" | "ocr" | "auto" | null;
      const observation = await sessions.observe(botId, mode ?? "auto");
      rememberOwner(botId);
      return json(res, 200, stripMeta(observation));
    } catch (error) {
      return json(res, 500, { ok: false, reason: errorText(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/act") {
    try {
      const body = await parseBody(req);
      const botId = String(body.botId ?? "unknown");
      if (!leaseHolder(req, botId)) return json(res, 403, { ok: false, reason: "no screen lease" });
      const action = body.action as Action;
      const result = await sessions.act(botId, action);
      rememberOwner(botId);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, reason: errorText(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/exec") {
    try {
      const body = (await parseBody(req)) as Partial<ExecRequest>;
      if (typeof body.command !== "string" || !body.command.trim()) {
        return json(res, 400, { ok: false, reason: "command is required" });
      }
      const result = await runExec(
        {
          command: body.command,
          ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
          ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
          ...(typeof body.stdin === "string" ? { stdin: body.stdin } : {}),
        },
        { cwd: existsSync(WORKSPACE) ? WORKSPACE : "/" },
        identity,
      );
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, reason: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/live") {
    const botId = url.searchParams.get("botId");
    if (!botId) {
      res.writeHead(400);
      res.end("botId is required");
      return;
    }
    let ready: { display: number; vncPort: number };
    try {
      ready = await sessions.ensureReady(botId);
      rememberOwner(botId);
    } catch (error) {
      // A failed display start must answer this request, not take the whole daemon down.
      return json(res, 500, { ok: false, reason: String(error) });
    }
    const { display, vncPort } = ready;
    const liveToken = randomBytes(24).toString("hex");
    const expires = Date.now() + 15 * 60_000;
    for (const [token, entry] of liveTokens) {
      if (entry.expires <= Date.now()) liveTokens.delete(token);
    }
    liveTokens.set(liveToken, { display, port: vncPort, expires });
    persistLiveTokens();
    setTimeout(() => {
      liveTokens.delete(liveToken);
      persistLiveTokens();
    }, 15 * 60_000).unref();
    return json(res, 200, {
      url: createLiveViewUrl(NOVNC_PORT, liveToken),
      token: liveToken,
      expiresAt: new Date(expires).toISOString(),
      display,
    });
  }

  res.writeHead(404);
  res.end("not found");
});

function rememberOwner(botId: string): void {
  const display = sessions.health().find((s) => s.botId === botId)?.display;
  if (display !== undefined) displayOwner.set(display, botId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

server.listen(PORT, "0.0.0.0", () => {
  telemetry.record({ kind: "boot_stage", stage: "daemon_listening", protocol: DAEMON_PROTOCOL });
  console.log(`openbot control daemon listening on ${PORT}`);
});

// `docker stop`: close the screens cleanly instead of waiting to be killed.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    sessions.shutdown();
    server.close();
    process.exit(0);
  });
}
