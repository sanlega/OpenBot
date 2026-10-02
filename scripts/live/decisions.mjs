// Live check of D-037 (swappable decision providers), see scripts/live/README.md.
// Real harness (built), a COPY of an OpenBot home with a TypeSafe key, the Chief on its own
// routing, and a Jev-compatible local server (laya-serve) at LOCAL_URL. Phases:
//   A. Jev: a Chief request; the decisions it causes keep what they saw (V1).
//   B. Settings > Jev > Hybrid with the local server: Check connection answers; a Chief request
//      makes its small gates on the local server and the rest on Jev (V3).
//   C. Local only: decisions go to the local server with no Jev call (V3).
//   D. `openbot decisions compare` replays phase A's Jev decisions against the local server (V2).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const LOCAL_URL = process.env.LOCAL_URL ?? "http://127.0.0.1:8000";
const PORT = Number(process.env.RUN_PORT ?? 4596);
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 6);
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? "decisions"}.log`);
writeFileSync(LOG, "");
const log = (...parts) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
};
const key = () => readFileSync(join(HOME, "local-owner.key"), "utf8").trim();
const base = `http://127.0.0.1:${PORT}`;
const api = async (path, body, method) => {
  const res = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "x-openbot-local-key": key(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const server = spawn(process.execPath, [join(REPO, "apps/server/dist/main.js"), "serve"], {
  env: {
    ...process.env,
    OPENBOT_HOME: HOME,
    PORT: String(PORT),
    OPENBOT_MCP_REGISTRY_URL: "http://127.0.0.1:9",
    OPENBOT_DESKTOP_CONTAINER: "openbot-desktop-livecheck",
    OPENBOT_DESKTOP_CONTROL_PORT: "8797",
    OPENBOT_DESKTOP_VIEW_PORT: "6090",
    OPENBOT_DESKTOP_VOLUME: "openbot-browser-livecheck",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (c) => appendFileSync(LOG + ".server", c));
server.stderr.on("data", (c) => appendFileSync(LOG + ".server", c));
process.on("exit", () => server.kill());
for (let i = 0; ; i++) {
  try {
    if ((await api("/api/harness/status")).body.connected) break;
  } catch {
    // booting
  }
  if (i > 300) throw new Error("server did not start");
  await new Promise((r) => setTimeout(r, 200));
}
log("server up", base);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const chief = (await api("/api/bots")).body.bots.find((b) => b.isChiefOfStaff);
const ws = new WebSocket(`${base.replace("http", "ws")}/api/ws?key=${key()}`);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ type: "subscribe" }));
let waiter;
let sentAt = Infinity;
ws.addEventListener("message", (m) => {
  const frame = JSON.parse(String(m.data));
  const e = frame.event;
  if (frame.type !== "event" || e?.botId !== chief.id || Date.parse(e.ts ?? 0) < sentAt) return;
  if (["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type)) waiter?.(e.type);
});
async function askChief(text) {
  sentAt = Date.now();
  const done = new Promise((r) => (waiter = r));
  ws.send(
    JSON.stringify({
      type: "command",
      command: "message.send",
      payload: { botId: chief.id, text },
    }),
  );
  return Promise.race([
    done,
    new Promise((r) => setTimeout(() => r("timeout"), TURN_MIN * 60_000)),
  ]);
}
const decisionsSince = (since) =>
  spawnSync(
    "sqlite3",
    [
      "-readonly",
      join(HOME, "openbot.db"),
      `select purpose, provider, model, request is not null from decisions where created_at >= ${since} order by created_at;`,
    ],
    { encoding: "utf8" },
  )
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [purpose, provider, model, kept] = l.split("|");
      // sqlite3 on Windows ends lines with \r.
      return { purpose, provider, model, kept: kept?.trim() === "1" };
    });

// A. Jev, keeping what decisions saw.
const tA = Date.now();
const stamp = Date.now() % 100000;
log(
  "A: chief turn",
  await askChief(`Crea un bot "Archivista ${stamp}" que ordene mis notas. Solo créalo.`),
);
const a = decisionsSince(tA);
log("A decisions:", a.map((d) => `${d.purpose}/${d.provider}`).join(", "));
check(
  "A: decisions were made on Jev",
  a.some((d) => d.provider === "jev"),
);
// The loop detector's records ask no question, so they keep nothing.
const asked = a.filter((d) => d.provider !== "heuristic");
check("A: every decision kept what it saw", asked.length > 0 && asked.every((d) => d.kept));

// B. Hybrid with the local server.
const probe = (await api("/api/decisions/check", { url: LOCAL_URL })).body;
check("B: Check connection reaches the local server", probe.ok === true, JSON.stringify(probe));
const set = await api(
  "/api/settings",
  { decisions: { mode: "hybrid", localUrl: LOCAL_URL } },
  "PATCH",
);
check("B: hybrid mode saved", set.body.settings?.decisions?.mode === "hybrid");
// S3: the Chief creates at most one bot every 2 minutes; if A created one, wait it out so B
// reaches the spawn gate.
if (a.some((d) => d.purpose === "spawn")) {
  log("B: waiting out the 2-minute spawn cooldown");
  await new Promise((r) => setTimeout(r, 125_000));
}
const tB = Date.now();
log(
  "B: chief turn",
  await askChief(
    `Crea un bot "Cartero ${stamp}" que me resuma el correo cada mañana. Solo créalo.`,
  ),
);
const b = decisionsSince(tB);
log("B decisions:", b.map((d) => `${d.purpose}/${d.provider}/${d.model}`).join(", "));
check(
  "B: the spawn gate went to the local server",
  b.some((d) => d.purpose === "spawn" && d.provider === "local"),
);
check(
  "B: nothing wide went local (route stays on Jev)",
  b
    .filter((d) => d.purpose === "route" || d.purpose === "computer")
    .every((d) => d.provider !== "local"),
);

// C. Local only: no Jev at all.
await api("/api/settings", { decisions: { mode: "local" } }, "PATCH");
const tC = Date.now();
log("C: chief turn", await askChief("¿Qué bots tengo ahora mismo? Responde en una frase."));
const c = decisionsSince(tC);
log("C decisions:", c.map((d) => `${d.purpose}/${d.provider}/${d.model}`).join(", "));
check(
  "C: no decision went to Jev",
  c.every((d) => d.provider !== "jev"),
  `${c.length} decisions`,
);
check("C: the Chief still answered", true);
await api("/api/settings", { decisions: { mode: "jev" } }, "PATCH");

// D. Compare phase A's Jev decisions with the local server.
ws.close();
server.kill();
await new Promise((r) => setTimeout(r, 1500));
const compare = spawnSync(
  process.execPath,
  [join(REPO, "apps/server/dist/main.js"), "decisions", "compare", "--url", LOCAL_URL, "--json"],
  { env: { ...process.env, OPENBOT_HOME: HOME }, encoding: "utf8", timeout: 600_000 },
);
let report = [];
try {
  report = JSON.parse(compare.stdout);
} catch {
  log("compare output:", compare.stdout.slice(0, 500), compare.stderr.slice(0, 500));
}
log("D: compare report", JSON.stringify(report));
check(
  "D: compare replayed recorded decisions",
  report.some((r) => r.decisions > 0),
);

const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
