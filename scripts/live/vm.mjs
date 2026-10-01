#!/usr/bin/env node
/**
 * Live check of the virtual machine (D-032/D-033) against a real desktop container, next to an
 * installed app's own (its own name, ports and browser volume):
 *   docker build -f images/desktop/Dockerfile -t openbot-desktop:dev .
 *   pnpm build && node scripts/live/vm.mjs
 * Checks: commands run inside the machine with developer tools; files written there appear in
 * the host workspace; installs persist; page text is read; a page with a "Leave site?" dialog
 * does not block navigation; a sign-in on one bot's screen is there on another's (a real site
 * with public test credentials); and after the container is recreated.
 * Env: VM_IMAGE (openbot-desktop:dev), VM_KEEP=1 keeps the container and volume.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createDockerProvider } from "../../packages/computer/docker/dist/index.js";

// dockerode is the docker package's dependency, not the repo root's.
const requireFromDocker = createRequire(
  new URL("../../packages/computer/docker/package.json", import.meta.url),
);

const image = process.env.VM_IMAGE ?? "openbot-desktop:dev";
const name = "openbot-desktop-livecheck";
const volume = "openbot-browser-livecheck";
const workspace = mkdtempSync(join(tmpdir(), "openbot-vm-"));
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

// A page that asks "Leave site?" once something was typed into it.
const site = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Draft</title><h1>Compose</h1>
<textarea aria-label="Post text"></textarea>
<script>addEventListener("beforeunload", (e) => { if (document.querySelector("textarea").value) { e.preventDefault(); e.returnValue = ""; } });</script>`);
});
await new Promise((r) => site.listen(4720, "0.0.0.0", r));

const provider = () =>
  createDockerProvider({
    image,
    containerName: name,
    controlPort: 8797,
    liveViewPort: 6090,
    browserVolume: volume,
    workspaceMount: workspace,
    idleStopMs: 0,
  });

const Docker = requireFromDocker("dockerode");
const docker = new Docker();
const removeContainer = async () => {
  const found = (await docker.listContainers({ all: true })).find((c) =>
    c.Names.includes(`/${name}`),
  );
  if (found) await docker.getContainer(found.Id).remove({ force: true });
};

try {
  await removeContainer();
  let vm = provider();
  await vm.ensureStarted();

  // 1. Commands and files inside the machine.
  const tools = await vm.exec({
    command:
      "git --version && python3 --version && pip --version | cut -c1-12 && rg --version | head -1 && pwd && echo $HOME",
  });
  check("vm_shell runs with developer tools", tools.code === 0, tools.stdout.replace(/\n/g, " | "));
  check(
    "default directory is /workspace, home on the volume",
    tools.stdout.includes("/workspace") && tools.stdout.includes("/data/home"),
  );
  const write = await vm.exec({
    command: "mkdir -p notes && cat > notes/hello.md",
    stdin: "# hi from the VM\n",
  });
  let onHost = "";
  try {
    onHost = readFileSync(join(workspace, "notes", "hello.md"), "utf8");
  } catch {}
  check(
    "a file written in the VM is in the host workspace",
    write.code === 0 && onHost.includes("hi from the VM"),
  );
  const install = await vm.exec({
    command: "pip install --user --quiet cowsay && python3 -m cowsay -t moo | head -3",
    timeoutMs: 180_000,
  });
  check(
    "pip install --user works",
    install.code === 0 && install.stdout.includes("moo"),
    install.stderr.slice(-200),
  );
  const timeout = await vm.exec({ command: "sleep 30", timeoutMs: 2_000 });
  check("a command that runs too long is stopped", timeout.timedOut === true);

  // 2. Browser: page text, and a page that asks before leaving.
  const a = await vm.screen("bot_live_a");
  await a.act({ op: "navigate", url: "http://host.docker.internal:4720/" });
  let page = await a.observe();
  check(
    "observation carries the page text",
    (page.text ?? "").includes("Compose"),
    page.text?.slice(0, 60),
  );
  const box = page.elements.find((el) => /post text/i.test(el.label));
  await a.act({ op: "type", target: box.index, text: "unsaved draft" });
  const started = Date.now();
  const nav = await a.act({ op: "navigate", url: "https://example.com/" });
  page = await a.observe();
  check(
    "navigation is not blocked by a Leave site? dialog",
    nav.ok && (page.url ?? "").startsWith("https://example.com"),
    `${Date.now() - started} ms, now on ${page.url}`,
  );

  // 3. Shared sign-ins on a real site (public test credentials of the-internet.herokuapp.com).
  await a.act({ op: "navigate", url: "https://the-internet.herokuapp.com/login" });
  page = await a.observe();
  const field = (re) => page.elements.find((el) => re.test(el.label) || re.test(el.role));
  await a.act({ op: "type", target: field(/username/i).index, text: "tomsmith" });
  page = await a.observe();
  await a.act({ op: "type", target: field(/password/i).index, text: "SuperSecretPassword!" });
  page = await a.observe();
  await a.act({
    op: "click",
    target: page.elements.find((el) => /login/i.test(el.label) && /button/i.test(el.role)).index,
  });
  await new Promise((r) => setTimeout(r, 2000));
  page = await a.observe();
  check(
    "bot A signs in",
    /secure area/i.test(page.text ?? "") && (page.url ?? "").endsWith("/secure"),
    page.url,
  );

  const b = await vm.screen("bot_live_b");
  await b.act({ op: "navigate", url: "https://the-internet.herokuapp.com/secure" });
  page = await b.observe();
  check(
    "bot B is signed in too",
    /secure area/i.test(page.text ?? "") && (page.url ?? "").endsWith("/secure"),
    page.url,
  );

  // 4. A new container (an app update) keeps the sign-in and the installs.
  await removeContainer();
  vm = provider();
  await vm.ensureStarted();
  const c = await vm.screen("bot_live_c");
  await c.act({ op: "navigate", url: "https://the-internet.herokuapp.com/secure" });
  page = await c.observe();
  check(
    "sign-in survives a new container",
    /secure area/i.test(page.text ?? "") && (page.url ?? "").endsWith("/secure"),
    page.url,
  );
  const again = await vm.exec({ command: "python3 -m cowsay -t moo | head -1" });
  check("user installs survive a new container", again.code === 0);
} catch (error) {
  check("no unexpected error", false, String(error?.stack ?? error));
} finally {
  site.close();
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
