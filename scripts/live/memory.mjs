// Live check of bots' memory (C5, plan 2026-10-01-grok-bot-box-roadmap), see scripts/live/README.md.
// Real harness (built), a COPY of an OpenBot home, a real engine (default: Claude). Creates two
// Bots, then:
//   1. bot A is told a fact about the user and saves it for every bot (remember, scope user);
//   2. the fact is visible through the Client API (the "What it knows" tab);
//   3. bot B, a different bot with no shared engine session, answers with that fact;
//   4. bot A forgets it on request, and it is gone.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const PORT = Number(process.env.RUN_PORT ?? 4593);
const ENGINE = process.env.RUN_ENGINE ?? "claude";
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 6);
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? "memory"}.log`);
writeFileSync(LOG, "");
const log = (...parts) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
};

const base = `http://127.0.0.1:${PORT}`;
const api = async (path, body, method) => {
  const res = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      // D-036: the copied home's owner key (the harness writes it on start).
      "x-openbot-local-key": readFileSync(join(HOME, "local-owner.key"), "utf8").trim(),
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

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const models =
  (await api("/api/models")).body.engines.find((e) => e.engine === ENGINE)?.models ?? [];
const MODEL = process.env.RUN_MODEL ?? models[0]?.id;
log("engine", ENGINE, "model", MODEL);

const stamp = Date.now() % 100000;
async function newBot(name) {
  const created = await api("/api/bots", {
    name: `${name} ${stamp}`,
    description: `${name}: a test bot for the memory live check. Be brief.`,
    routing: { mode: "pinned", engine: ENGINE, model: MODEL },
    permissionPreset: "workspace_write",
    computer: "none",
  });
  return { bot: created.body.bot, threadId: created.body.thread?.id };
}
const a = await newBot("Notes");
const b = await newBot("Planner");

const ws = new WebSocket(base.replace("http", "ws") + "/api/ws");
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ type: "subscribe" }));
const events = [];
ws.addEventListener("message", (m) => {
  const frame = JSON.parse(String(m.data));
  if (frame.type !== "event") return;
  const e = frame.event;
  if (e.botId !== a.bot.id && e.botId !== b.bot.id) return;
  events.push(e);
  const p = e.payload ?? {};
  if (e.type === "tool.started")
    log("  tool", p.toolName, JSON.stringify(p.input ?? {}).slice(0, 160));
  else if (e.type.startsWith("turn.")) log(e.type, String(p.errorMessage ?? "").slice(0, 200));
});

async function turn(who, text) {
  const from = events.length;
  ws.send(
    JSON.stringify({
      type: "command",
      command: "message.send",
      payload: { botId: who.bot.id, threadId: who.threadId, text },
    }),
  );
  log("USER ->", who.bot.name, ":", text);
  const started = Date.now();
  while (Date.now() - started < TURN_MIN * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const mine = events.slice(from).filter((e) => e.botId === who.bot.id);
    const end = mine.find((e) =>
      ["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type),
    );
    if (end) {
      const reply = String(end.payload?.text ?? "");
      log("REPLY", reply.slice(0, 300));
      return { end: end.type, events: mine, reply };
    }
  }
  return { end: "timeout", events: [], reply: "" };
}

const fact = "teal";
const t1 = await turn(
  a,
  `Please remember this about me, for every bot from now on: my favourite colour is ${fact}. Save it with your memory tool.`,
);
check("bot A completed", t1.end === "turn.completed");
check(
  "bot A called remember",
  t1.events.some((e) => e.type === "tool.started" && /remember/.test(e.payload?.toolName ?? "")),
);
const known = (await api(`/api/bots/${b.bot.id}/memories`)).body.memories ?? [];
const saved = known.find((m) => new RegExp(fact, "i").test(m.content));
check(
  "the fact is shared with every bot (scope user)",
  saved?.scope === "user",
  JSON.stringify(saved ?? {}),
);

const t2 = await turn(b, "What's my favourite colour? Reply with just the colour.");
check("bot B completed", t2.end === "turn.completed");
check(
  "bot B knows it without being told",
  new RegExp(fact, "i").test(t2.reply),
  t2.reply.slice(0, 80),
);

const t3 = await turn(
  a,
  "I no longer want you to remember my favourite colour. Forget it with your memory tool.",
);
check(
  "bot A called forget",
  t3.events.some((e) => e.type === "tool.started" && /forget/.test(e.payload?.toolName ?? "")),
);
const after = (await api(`/api/bots/${b.bot.id}/memories`)).body.memories ?? [];
check("the fact is gone", !after.some((m) => new RegExp(fact, "i").test(m.content)));

const failed = results.filter((r) => !r.ok);
log("SUMMARY", `${results.length - failed.length}/${results.length} passed`);
server.kill();
process.exit(failed.length ? 1 : 0);
