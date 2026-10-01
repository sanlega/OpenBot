// Live check of B5 (plan 2026-10-01-grok-bot-box-roadmap), see scripts/live/README.md.
// Real harness (built), a COPY of an OpenBot home, a real engine (default: Claude), the real
// Playwright MCP connector and a second desktop container from a local image. A Bot whose
// computer is the virtual machine gets the Playwright connector: it must run as `vm-browser`,
// pointed at the bot's VM browser through the filtered DevTools proxy, and answer from a page it
// opened with it, with no approval card and no browser on this computer.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME = process.env.RUN_HOME;
if (!HOME) throw new Error("RUN_HOME: a COPY of an OpenBot home (never the live ~/.openbot)");
const PORT = Number(process.env.RUN_PORT ?? 4594);
const ENGINE = process.env.RUN_ENGINE ?? "claude";
const TURN_MIN = Number(process.env.RUN_TURN_MIN ?? 8);
const IMAGE = process.env.VM_IMAGE ?? "openbot-desktop:dev";
const CONTAINER = "openbot-desktop-connectorcheck";
const VOLUME = "openbot-browser-connectorcheck";
const here = process.env.RUN_OUT ?? process.cwd();
const LOG = join(here, `${process.env.RUN_TAG ?? "vmconnector"}.log`);
writeFileSync(LOG, "");
const log = (...parts) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
};

const Docker = createRequire(
  new URL("../../packages/computer/docker/package.json", import.meta.url),
)("dockerode");
const docker = new Docker();
async function removeBox() {
  const found = (await docker.listContainers({ all: true })).find((c) =>
    c.Names.includes(`/${CONTAINER}`),
  );
  if (found) await docker.getContainer(found.Id).remove({ force: true });
  await docker
    .getVolume(VOLUME)
    .remove()
    .catch(() => undefined);
}
await removeBox();

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
    OPENBOT_DESKTOP_IMAGE: IMAGE,
    OPENBOT_DESKTOP_CONTAINER: CONTAINER,
    OPENBOT_DESKTOP_CONTROL_PORT: "8796",
    OPENBOT_DESKTOP_VIEW_PORT: "6093",
    OPENBOT_DESKTOP_VOLUME: VOLUME,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (c) => appendFileSync(LOG + ".server", c));
server.stderr.on("data", (c) => appendFileSync(LOG + ".server", c));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};

try {
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
  const started = await api("/api/computer/start", {});
  log("computer", started.status, JSON.stringify(started.body).slice(0, 120));

  const conn = await api("/api/connectors/connect", {
    catalogId: "curated:playwright",
    values: {},
  });
  const connectionId = conn.body.connection?.id;
  log("connection", conn.status, connectionId);
  const models =
    (await api("/api/models")).body.engines.find((e) => e.engine === ENGINE)?.models ?? [];
  const created = await api("/api/bots", {
    name: `Browser ${Date.now() % 10000}`,
    description: "A test bot for the VM connector check. Be brief.",
    routing: { mode: "pinned", engine: ENGINE, model: process.env.RUN_MODEL ?? models[0]?.id },
    permissionPreset: "workspace_write",
    computer: "docker",
  });
  const bot = created.body.bot;
  const threadId = created.body.thread?.id;
  await api(`/api/bots/${bot.id}/connectors`, { connectors: [connectionId] }, "PUT");

  const ws = new WebSocket(base.replace("http", "ws") + "/api/ws");
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.send(JSON.stringify({ type: "subscribe" }));
  const events = [];
  ws.addEventListener("message", (m) => {
    const frame = JSON.parse(String(m.data));
    if (frame.type !== "event" || frame.event.botId !== bot.id) return;
    events.push(frame.event);
    const p = frame.event.payload ?? {};
    if (frame.event.type === "tool.started")
      log("  tool", p.toolName, JSON.stringify(p.input ?? {}).slice(0, 140));
    else if (frame.event.type.startsWith("turn.") || frame.event.type.startsWith("approval."))
      log(frame.event.type, JSON.stringify(p).slice(0, 200));
  });

  ws.send(
    JSON.stringify({
      type: "command",
      command: "message.send",
      payload: {
        botId: bot.id,
        threadId,
        text: "Use your vm-browser tools (the Playwright connector) to open https://example.com/ and tell me the page's title, exactly.",
      },
    }),
  );
  const t0 = Date.now();
  let end;
  let cards = 0;
  while (!end && Date.now() - t0 < TURN_MIN * 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const pending = ((await api("/api/approvals")).body.approvals ?? []).filter(
      (a) => a.status === "pending" && a.botId === bot.id,
    );
    for (const a of pending) {
      cards += 1;
      log("CARD (allowed)", a.summary, (a.detail ?? "").slice(0, 160));
      await api(`/api/approvals/${a.id}/resolve`, { resolution: "allow" });
    }
    end = events.find((e) =>
      ["turn.completed", "turn.failed", "turn.interrupted"].includes(e.type),
    );
  }
  const reply = String(end?.payload?.text ?? "");
  log("REPLY", reply.slice(0, 300));
  const calls = events
    .filter((e) => e.type === "tool.started")
    .map((e) => e.payload?.toolName ?? "");
  check("the turn completed", end?.type === "turn.completed", end?.payload?.errorMessage ?? "");
  check(
    "the bot used the connector as vm-browser",
    calls.some((name) => /vm-browser/.test(name)),
    calls.join(", "),
  );
  check("it answered from the page it opened", /example domain/i.test(reply), reply.slice(0, 80));
  log("cards", cards);

  // The connector's page is in the VM browser.
  const found = (await docker.listContainers()).find((c) => c.Names.includes(`/${CONTAINER}`));
  const exec = await docker.getContainer(found.Id).exec({
    Cmd: ["bash", "-lc", "for p in 9221 9222 9223 9224; do curl -s 127.0.0.1:$p/json/list; done"],
    AttachStdout: true,
  });
  const stream = await exec.start({});
  let out = "";
  await new Promise((r) => {
    stream.on("data", (c) => (out += c.toString("utf8")));
    stream.on("end", r);
  });
  check("the page was opened in the virtual machine", out.includes("example.com"));
} catch (error) {
  check("no unexpected error", false, String(error?.stack ?? error));
} finally {
  server.kill();
  if (!process.env.VM_KEEP) await removeBox().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  log("SUMMARY", `${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
