#!/usr/bin/env node
/**
 * Live check of the hardened box (D-034, plan 2026-10-01-grok-bot-box-roadmap) against a real
 * desktop container next to an installed app's own (its own name, ports and browser volume):
 *   docker build -f images/desktop/Dockerfile -t openbot-desktop:dev .
 *   pnpm build && node scripts/live/box.mjs
 * Checks: bot commands run as an unprivileged user with no capabilities and cannot read the
 * daemon's token, the browser profiles, nor reach the daemon or a browser's DevTools port;
 * system packages still install; the self-check passes; a killed browser or VNC server comes
 * back by itself and the bot keeps working; a fork bomb does not take the desktop down; no
 * zombies pile up; `docker stop` is quick.
 * Env: VM_IMAGE (openbot-desktop:dev), VM_KEEP=1 keeps the container and volume.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createDockerProvider } from "../../packages/computer/docker/dist/index.js";

const requireFromDocker = createRequire(
  new URL("../../packages/computer/docker/package.json", import.meta.url),
);

const image = process.env.VM_IMAGE ?? "openbot-desktop:dev";
const name = "openbot-desktop-boxcheck";
const volume = "openbot-browser-boxcheck";
const workspace = mkdtempSync(join(tmpdir(), "openbot-box-"));
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Docker = requireFromDocker("dockerode");
const docker = new Docker();
const container = async () =>
  (await docker.listContainers({ all: true })).find((c) => c.Names.includes(`/${name}`));
const removeContainer = async () => {
  const found = await container();
  if (found) await docker.getContainer(found.Id).remove({ force: true });
};
/** Runs a command as root inside the container (what an operator, not a bot, can do). */
async function rootExec(cmd) {
  const found = await container();
  const exec = await docker.getContainer(found.Id).exec({
    Cmd: ["bash", "-lc", cmd],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  let out = "";
  await new Promise((resolve) => {
    stream.on("data", (chunk) => (out += chunk.toString("utf8")));
    stream.on("end", resolve);
  });
  // Docker multiplexes stdout/stderr with binary frame headers: keep printable text only.
  return [...out].filter((ch) => ch.charCodeAt(0) > 8).join("");
}

// An app that keeps its sign-in in localStorage (like Notion or Linear), not in a cookie.
const app = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Notes app</title><h1 id="s"></h1>
<button onclick="localStorage.setItem('session', 'user-42'); document.getElementById('s').textContent = 'Signed in as user-42'">Sign in</button>
<script>document.getElementById("s").textContent = localStorage.getItem("session") ? "Signed in as user-42" : "Signed out";</script>`);
});
await new Promise((r) => app.listen(4721, "0.0.0.0", r));

const vm = createDockerProvider({
  image,
  containerName: name,
  controlPort: 8798,
  liveViewPort: 6091,
  browserVolume: volume,
  workspaceMount: workspace,
  idleStopMs: 0,
});

try {
  await removeContainer();
  await vm.ensureStarted();

  // 1. Who a bot's command is.
  const who = await vm.exec({ command: "id -u; grep CapEff /proc/self/status; echo $HOME" });
  check(
    "bot commands run as uid 1000 with no capabilities",
    /^1000\n/.test(who.stdout) && /CapEff:\s+0+\n/.test(who.stdout),
    who.stdout.replace(/\n/g, " | "),
  );
  const token = vm.getControlToken();
  const snoop = await vm.exec({
    command:
      "for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null | tr '\\0' '\\n'; done | grep -c OPENBOT_CONTROL_TOKEN; env | grep -c OPENBOT_CONTROL_TOKEN",
  });
  check(
    "no process environment a bot can read holds the daemon token",
    !snoop.stdout.includes(token) && /^0\n0\n?$/.test(snoop.stdout.trim() + "\n"),
    snoop.stdout.replace(/\n/g, " "),
  );
  const profiles = await vm.exec({ command: "ls /data/browser" });
  check("browser profiles are out of reach", profiles.code !== 0, profiles.stderr.trim());

  // A screen first, so a browser's DevTools port exists.
  const a = await vm.screen("bot_box_a");
  await a.act({ op: "navigate", url: "https://example.com/" });
  let page = await a.observe();
  check("a bot's screen works", /documentation examples/i.test(page.text ?? ""));
  const reach = await vm.exec({
    command:
      "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8787/health; echo; curl -s --max-time 3 http://127.0.0.1:9221/json/version | head -c 80; echo; curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:6080/; echo",
  });
  check(
    "the daemon, DevTools and noVNC ports are closed to bots",
    !/200|401/.test(reach.stdout) && !reach.stdout.includes("Browser"),
    reach.stdout.replace(/\n/g, " | "),
  );
  // Both X transports: the path socket (root-only) and the abstract one (not listening).
  const xsock = await vm.exec({
    command: [
      "python3 - <<'PY'",
      "import socket",
      "for addr in ['/tmp/.X11-unix/X1', '\\0/tmp/.X11-unix/X1']:",
      "    s = socket.socket(socket.AF_UNIX)",
      "    try:",
      "        s.connect(addr); print('OPEN', repr(addr))",
      "    except OSError as e:",
      "        print('closed', repr(addr), e.strerror)",
      "PY",
    ].join("\n"),
  });
  const rootX = await rootExec("DISPLAY=:1 xdotool getmouselocation");
  check(
    "the X display is closed to bots (and open to the desktop)",
    !xsock.stdout.includes("OPEN") && /closed/.test(xsock.stdout) && /x:\d+ y:\d+/.test(rootX),
    `${xsock.stdout.trim().replace(/\n/g, " | ")} | root: ${rootX.trim()}`,
  );

  // 2. Packages still install (through the root helper).
  const apt = await vm.exec({
    command: "sudo apt-get install -y sl >/dev/null && dpkg -s sl | grep Status",
    timeoutMs: 300_000,
  });
  check(
    "system packages install without root",
    apt.stdout.includes("install ok installed"),
    apt.stderr.slice(-200),
  );
  const rm = await vm.exec({ command: "apt-get remove -y chromium" });
  check("bots cannot remove system packages", rm.code !== 0);

  // 3. The self-check.
  const report = await vm.diagnose();
  const failed = report.checks.filter((c) => !c.ok);
  check(
    "the box self-check passes",
    failed.length === 0,
    failed.length
      ? failed.map((c) => `${c.name}: ${c.detail}`).join("; ")
      : `${report.checks.length} checks`,
  );

  // 4. Supervision: kill the browser and the VNC server; they come back and the bot keeps going.
  await rootExec("pkill -KILL -f 'chromium.*remote-debugging-port=9221' ; pkill -KILL x11vnc");
  await sleep(4_000);
  let recovered = false;
  for (let i = 0; i < 10 && !recovered; i++) {
    try {
      await a.act({ op: "navigate", url: "https://example.com/" });
      page = await a.observe();
      recovered = /documentation examples/i.test(page.text ?? "");
    } catch {
      await sleep(1_500);
    }
  }
  check("a killed browser comes back and the bot keeps working", recovered);
  const health = (await vm.diagnose()).screens.find((s) => s.botId === "bot_box_a");
  const vnc = health?.components.find((c) => c.name === "vnc");
  const browser = health?.components.find((c) => c.name === "browser");
  check(
    "the live view server came back, and the crash was recorded",
    Boolean(vnc?.up && browser?.up && browser.restartsInWindow >= 1),
    JSON.stringify(health?.components.map((c) => [c.name, c.up, c.restartsInWindow, c.downReason])),
  );

  // 5. A fork bomb is contained.
  await vm
    .exec({ command: "bomb(){ bomb | bomb & }; bomb", timeoutMs: 8_000 })
    .catch(() => undefined);
  await sleep(2_000);
  await rootExec("pkill -KILL -u box || true");
  page = await a.observe().catch(() => ({ text: "" }));
  check(
    "a fork bomb does not take the desktop down",
    /documentation examples/i.test(page.text ?? ""),
  );

  // 5b. A sign-in kept in localStorage on one screen reaches another screen (B2).
  const appUrl = "http://host.docker.internal:4721/";
  await a.act({ op: "navigate", url: appUrl });
  page = await a.observe();
  const signIn = page.elements.find((el) => /sign in/i.test(el.label));
  if (signIn) await a.act({ op: "click", target: signIn.index });
  await sleep(1_000);
  page = await a.observe();
  const aSignedIn = /Signed in as user-42/.test(page.text ?? "");
  const b = await vm.screen("bot_box_b");
  await b.act({ op: "navigate", url: appUrl });
  let bPage = await b.observe();
  // The first look seeds the session and reloads; the page then reads it.
  for (let i = 0; i < 3 && !/Signed in/.test(bPage.text ?? ""); i++) {
    await sleep(3_500);
    bPage = await b.observe();
  }
  check(
    "a sign-in kept in localStorage on one screen reaches another",
    aSignedIn && /Signed in as user-42/.test(bPage.text ?? ""),
    `A: ${aSignedIn}, B: ${(bPage.text ?? "").slice(0, 40)}`,
  );

  // 6. No zombies, quick stop.
  const zombies = Number((await rootExec("ps -eo stat= | grep -c '^Z' || true")).trim() || 0);
  check("no zombie processes pile up", zombies === 0, `${zombies} zombies`);
  const found = await container();
  const started = Date.now();
  await docker.getContainer(found.Id).stop({ t: 10 });
  const took = Date.now() - started;
  check("docker stop is quick", took < 5_000, `${took} ms`);
} catch (error) {
  check("no unexpected error", false, String(error?.stack ?? error));
} finally {
  app.close();
  if (!process.env.VM_KEEP) {
    await removeContainer().catch(() => undefined);
    await docker
      .getVolume(volume)
      .remove()
      .catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
