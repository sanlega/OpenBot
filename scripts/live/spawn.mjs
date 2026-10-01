// Live check: when the user explicitly asks the Chief of Staff to create a bot, the spawn gate
// lets it (found in v0.1.19: Jev never saw the user's messages, so "create a bot X" was denied).
// Real harness (built), a COPY of an OpenBot home with a TypeSafe key, the Chief on its own
// routing. Sends the request, waits for the Chief's turn, checks that a bot with that name exists.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const PORT = Number(process.env.RUN_PORT ?? 4595);
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 6);
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? "spawn"}.log`);
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
    // Never the installed app's virtual machine.
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
    // still booting
  }
  if (i > 300) throw new Error("server did not start");
  await new Promise((r) => setTimeout(r, 200));
}
log("server up", base);

const bots = (await api("/api/bots")).body.bots;
const chief = bots.find((b) => b.isChiefOfStaff);
if (!chief) throw new Error("no Chief of Staff in this home");
const name = `Investigador ${Date.now() % 100000}`;

const ws = new WebSocket(`${base.replace("http", "ws")}/api/ws?key=${key()}`);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ type: "subscribe" }));
let ended;
let sentAt = Infinity;
const done = new Promise((resolve) => (ended = resolve));
ws.addEventListener("message", (m) => {
  const frame = JSON.parse(String(m.data));
  const e = frame.event;
  // subscribe replays history: only what happens after the request counts.
  if (frame.type !== "event" || e?.botId !== chief.id || Date.parse(e.ts ?? 0) < sentAt) return;
  if (e.type === "tool.started") log("tool", e.payload?.toolName);
  if (["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type)) ended(e.type);
});

sentAt = Date.now();
ws.send(
  JSON.stringify({
    type: "command",
    command: "message.send",
    payload: {
      botId: chief.id,
      text: `Crea un bot "${name}" que investigue en su máquina virtual precios de gestores de tareas. Solo créalo y dile hola; no hace falta que investigue todavía.`,
    },
  }),
);
const outcome = await Promise.race([
  done,
  new Promise((r) => setTimeout(() => r("timeout"), TURN_MIN * 60_000)),
]);
log("chief turn", outcome);

const after = (await api("/api/bots")).body.bots;
const created = after.find((b) => b.name.toLowerCase() === name.toLowerCase());
log(created ? "PASS" : "FAIL", "the bot the user asked for exists:", created?.name ?? "(none)");
const db = (await api("/api/decisions?purpose=spawn")).body.decisions ?? [];
const last = [...db].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
log("last spawn decision:", JSON.stringify(last?.answers?.user_requested ?? last));
ws.close();
server.kill();
process.exit(created ? 0 : 1);
