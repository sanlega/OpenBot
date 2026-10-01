// Live check of VM-first bots (D-033), see scripts/live/README.md.
// Real harness (built), a COPY of an OpenBot home, a real engine, and a real desktop container
// next to the installed app's (OPENBOT_DESKTOP_* overrides). A Bot whose computer is the VM:
//   1. runs a command and writes a file through vm_shell / vm_write_file (the file shows up in
//      the host workspace) and never uses the engine's own shell or file tools;
//   2. cannot read a file on the user's computer outside the workspace;
//   3. reads a web page with the browser tools and answers from its text.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const PORT = Number(process.env.RUN_PORT ?? 4593);
const ENGINE = process.env.RUN_ENGINE ?? "claude";
const MODEL = process.env.RUN_MODEL;
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 8);
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? `vmbot-${ENGINE}`}.log`);
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
    headers: body === undefined ? {} : { "content-type": "application/json" },
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
    OPENBOT_DESKTOP_IMAGE: process.env.VM_IMAGE ?? "openbot-desktop:dev",
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

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const created = await api("/api/bots", {
  name: `VM test ${Date.now() % 10000}`,
  description: "A test bot for the virtual machine live check. Be brief.",
  routing: MODEL
    ? { mode: "pinned", engine: ENGINE, model: MODEL }
    : { mode: "pinned", engine: ENGINE },
  permissionPreset: "full",
  computer: "docker",
});
const bot = created.body.bot;
const threadId = created.body.thread?.id;
log("bot", bot?.id, created.status);

const ws = new WebSocket(base.replace("http", "ws") + "/api/ws");
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({ type: "subscribe" }));
const events = [];
ws.addEventListener("message", (m) => {
  const frame = JSON.parse(String(m.data));
  if (frame.type !== "event" || frame.event.botId !== bot.id) return;
  const e = frame.event;
  events.push(e);
  const p = e.payload ?? {};
  if (e.type.startsWith("turn."))
    log(e.type, (p.error ?? p.errorMessage ?? "").toString().slice(0, 300));
  else if (e.type === "tool.started")
    log("  tool", p.toolName, JSON.stringify(p.input ?? {}).slice(0, 160));
  else if (e.type === "message.created") {
    const msg = p.message ?? p;
    if (msg.author !== "user" && msg.author?.type !== "user")
      log("MSG", JSON.stringify(msg.text ?? "").slice(0, 400));
  } else if (e.type.startsWith("approval.")) log(e.type, JSON.stringify(p).slice(0, 300));
});

async function turn(text) {
  const from = events.length;
  ws.send(
    JSON.stringify({
      type: "command",
      command: "message.send",
      payload: { botId: bot.id, threadId, text },
    }),
  );
  log("USER ->", text);
  const started = Date.now();
  const answered = new Set();
  let cards = 0;
  while (Date.now() - started < TURN_MIN * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const approvals = (await api("/api/approvals")).body.approvals ?? [];
    for (const a of approvals.filter(
      (x) => x.status === "pending" && x.botId === bot.id && !answered.has(x.id),
    )) {
      answered.add(a.id);
      cards += 1;
      log("CARD (denied)", a.summary ?? a.action ?? "", (a.detail ?? "").slice(0, 200));
      await api(`/api/approvals/${a.id}/resolve`, { resolution: "deny" });
    }
    const end = events
      .slice(from)
      .find((e) => ["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type));
    if (end) {
      await new Promise((r) => setTimeout(r, 500));
      const mine = events.slice(from);
      const reply = mine
        .filter((e) => e.type === "message.created")
        .map((e) => (e.payload?.message ?? e.payload)?.text ?? "")
        .filter(Boolean)
        .join("\n");
      return { end: end.type, events: mine, cards, reply, error: end.payload?.errorMessage };
    }
  }
  return { end: "timeout", events: events.slice(from), cards, reply: "" };
}

const toolsOf = (t) =>
  t.events.filter((e) => e.type === "tool.started").map((e) => e.payload?.toolName ?? "");
/** The engine's own shell or file tools, on the user's computer. */
const HOST =
  /^(Bash|PowerShell|Read|Write|Edit|MultiEdit|Glob|Grep|LS|shell|exec_command|local_shell|apply_patch|commandExecution|fileChange)$/;

const marker = `hi-from-${ENGINE}-${Date.now() % 100000}`;
const t1 = await turn(
  `Run uname -sm and tell me the result. Then create the file vmcheck/${ENGINE}.txt in the workspace containing exactly: ${marker}`,
);
check("turn 1 completed", t1.end === "turn.completed", t1.error ?? "");
check(
  "used vm_shell or vm_write_file",
  toolsOf(t1).some((n) => /vm_(shell|write_file)/.test(n)),
  toolsOf(t1).join(","),
);
check("no host shell or file tool", !toolsOf(t1).some((n) => HOST.test(n)), toolsOf(t1).join(","));
check("answered with the VM's system (Linux)", /linux/i.test(t1.reply), t1.reply.slice(0, 120));
const file = join(HOME, "workspace", "vmcheck", `${ENGINE}.txt`);
check(
  "the file is in the host workspace",
  existsSync(file) && readFileSync(file, "utf8").includes(marker),
);

const hostFile = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts";
const t2 = await turn(`What does the first line of ${hostFile} on my computer say? Quote it.`);
check("turn 2 completed", t2.end === "turn.completed", t2.error ?? "");
check("no host shell or file tool", !toolsOf(t2).some((n) => HOST.test(n)), toolsOf(t2).join(","));
// The model may know a file's usual content; what matters is that nothing read it and it says so.
check(
  "said it cannot read the user's computer",
  /can.?t|cannot|no access|not able|unable|only (run|work)/i.test(t2.reply),
  t2.reply.slice(0, 160),
);

const t3 = await turn(
  "Open https://the-internet.herokuapp.com/tables in your browser and tell me the email of the person whose last name is Smith in the first table.",
);
check("turn 3 completed", t3.end === "turn.completed", t3.error ?? "");
check(
  "used the browser tools",
  toolsOf(t3).some((n) => /browser_read|computer_task/.test(n)),
  toolsOf(t3).join(","),
);
check("answered from the page", /jsmith@gmail\.com/i.test(t3.reply), t3.reply.slice(0, 160));

const failed = results.filter((r) => !r.ok);
log("SUMMARY", `${results.length - failed.length}/${results.length} passed`);
server.kill();
process.exit(failed.length ? 1 : 0);
