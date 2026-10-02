// Live check of V4 (visual checks, D-037), see scripts/live/README.md. Needs the desktop image
// built from this checkout (VM_IMAGE, default openbot-desktop:dev) and, for the model part, an
// image decision server (VISION_URL, e.g. ImaJev's playground server on :8765).
//   1. The daemon's /screenshot returns a JPEG of the bot's page, at most 400,000 pixels.
//   2. Without the bot's screen lease it is refused.
//   3. The image model reads real screenshots, asked exactly what the computer loop asks (goal,
//      url, title, the picture): an order confirmation shows "place the order" done; a sign-in
//      page is a wall and not the goal done.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createDockerProvider } from "../../packages/computer/docker/dist/index.js";

const requireFromDocker = createRequire(
  new URL("../../packages/computer/docker/package.json", import.meta.url),
);
const Docker = requireFromDocker("dockerode");
const docker = new Docker();
const image = process.env.VM_IMAGE ?? "openbot-desktop:dev";
const VISION_URL = process.env.VISION_URL;
const name = "openbot-desktop-visioncheck";
const volume = "openbot-browser-visioncheck";
const workspace = mkdtempSync(join(tmpdir(), "openbot-vision-"));
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const removeContainer = async () => {
  const [found] = await docker.listContainers({ all: true, filters: { name: [name] } });
  if (found) await docker.getContainer(found.Id).remove({ force: true });
};

// Two pages a computer task may end on.
const pages = {
  "/done": `<!doctype html><title>Order confirmed</title><body style="font-family:sans-serif;text-align:center;padding-top:80px">
<h1 style="color:#157a4b">&#10004; Order confirmed</h1><p style="font-size:20px">Thank you! Your order #4821 for 2 notebooks has been placed.</p>
<p>A receipt was sent to your email.</p></body>`,
  "/login": `<!doctype html><title>Shop</title><body style="font-family:sans-serif;display:grid;place-items:center;height:90vh">
<form style="border:1px solid #ccc;padding:32px;border-radius:8px;width:320px"><h2>Sign in to continue</h2>
<p>You need an account to place your order.</p><label>Email<br><input style="width:100%" type="email"></label><br><br>
<label>Password<br><input style="width:100%" type="password"></label><br><br><button>Sign in</button></form></body>`,
};
const site = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(pages[req.url] ?? "not found");
});
await new Promise((r) => site.listen(4722, "0.0.0.0", r));
const siteUrl = (path) => `http://host.docker.internal:4722${path}`;

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(buffer) {
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return undefined;
    const marker = buffer[i + 1];
    const length = buffer.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return undefined;
}

/** The computer loop's visual question (packages/computer/src/fast-loop.ts, lookAtScreen). */
async function ask(picture, goal, observation) {
  const res = await fetch(`${VISION_URL}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: { goal, url: observation.url, title: observation.title },
      questions: {
        goal_met: {
          type: "choice",
          instructions:
            "Does the screenshot show that `goal` is accomplished (the requested page or result is on screen)?",
          criteria: {
            yes: "The screen shows the goal is done",
            no: "The goal is not done, or the screen doesn't show it",
          },
        },
        wall: {
          type: "noul",
          instructions:
            "The screen asks the user to sign in (an email or password form), solve a CAPTCHA, or prove they are human before going on.",
        },
      },
      images: [`data:${picture.mime};base64,${picture.data}`],
    }),
  });
  return res.json();
}

const vm = createDockerProvider({
  image,
  containerName: name,
  controlPort: 8799,
  liveViewPort: 6092,
  browserVolume: volume,
  workspaceMount: workspace,
  idleStopMs: 0,
});

try {
  await removeContainer();
  await vm.ensureStarted();
  const screen = await vm.screen("bot_vision_a");
  await screen.act({ op: "navigate", url: siteUrl("/done") });
  const doneObservation = await screen.observe();

  // 1. The picture.
  const done = await screen.screenshot();
  const bytes = Buffer.from(done.data, "base64");
  if (process.env.SHOT_OUT) writeFileSync(process.env.SHOT_OUT, bytes);
  const size = jpegSize(bytes);
  check("the daemon returns a JPEG of the page", done.mime === "image/jpeg" && Boolean(size));
  check(
    "it is at most 400,000 pixels",
    Boolean(size) && size.width * size.height <= 400_000,
    size ? `${size.width}x${size.height}, ${Math.round(bytes.length / 1024)} KB` : "unreadable",
  );

  // 2. No lease, no picture.
  const token = vm.getControlToken();
  const refused = await fetch("http://127.0.0.1:8799/screenshot?botId=bot_vision_a&display=1", {
    headers: { authorization: `Bearer ${token}` },
  });
  check("without the screen lease it is refused", refused.status === 403, `HTTP ${refused.status}`);

  // 3. The image model on real pages.
  if (VISION_URL) {
    const orderDone = await ask(done, "Place the order for the notebooks", doneObservation);
    await screen.act({ op: "navigate", url: siteUrl("/login") });
    const loginObservation = await screen.observe();
    const login = await screen.screenshot();
    const blocked = await ask(login, "Place the order for the notebooks", loginObservation);
    const show = (r) =>
      `goal_met=${r.answers?.goal_met?.choice}@${r.answers?.goal_met?.confidence?.toFixed(2)} wall=${r.answers?.wall?.noul?.toFixed(2)}`;
    console.log(
      `model ${orderDone.model}: confirmation ${show(orderDone)}; sign-in ${show(blocked)}`,
    );
    check(
      "the model sees the order placed on the confirmation",
      orderDone.answers?.goal_met?.choice === "yes",
    );
    check("a confirmation page is not a wall", (orderDone.answers?.wall?.noul ?? 1) < 0.5);
    check("on the sign-in page the goal is not done", blocked.answers?.goal_met?.choice === "no");
    check("the sign-in page is a wall", (blocked.answers?.wall?.noul ?? 0) >= 0.5);
  } else {
    console.log("VISION_URL not set: the model part is skipped.");
  }
} catch (error) {
  check("no unexpected error", false, String(error?.stack ?? error));
} finally {
  site.close();
  await removeContainer().catch(() => undefined);
  await docker
    .getVolume(volume)
    .remove()
    .catch(() => undefined);
  rmSync(workspace, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
