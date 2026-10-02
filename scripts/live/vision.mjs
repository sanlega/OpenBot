// Live check of V4 (visual checks, D-037), see scripts/live/README.md. Needs the desktop image
// built from this checkout (VM_IMAGE, default openbot-desktop:dev) and, for the model part, an
// image decision server (VISION_URL, e.g. ImaJev's playground server on :8765).
//   1. The daemon's /screenshot returns a JPEG of the bot's page, at most 400,000 pixels.
//   2. Without the bot's screen lease it is refused.
//   3. The image model reads that real screenshot: the goal shown is "yes", a goal not shown is
//      "no", and an ordinary page is not a sign-in/CAPTCHA wall.
import { mkdtempSync, rmSync } from "node:fs";
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

async function ask(picture, goal) {
  const res = await fetch(`${VISION_URL}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: { goal },
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
            "The screenshot shows a sign-in page, a CAPTCHA or a bot check that blocks the page.",
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
  await screen.act({ op: "navigate", url: "https://example.com/" });
  await screen.observe();

  // 1. The picture.
  const picture = await screen.screenshot();
  const bytes = Buffer.from(picture.data, "base64");
  const size = jpegSize(bytes);
  check("the daemon returns a JPEG of the page", picture.mime === "image/jpeg" && Boolean(size));
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

  // 3. The image model reads the real picture.
  if (VISION_URL) {
    const shown = await ask(picture, "Open the example.com page");
    const notShown = await ask(picture, "Show the YouTube home page with videos");
    console.log(
      "model:",
      shown.model,
      JSON.stringify(shown.answers),
      JSON.stringify(notShown.answers),
    );
    check("the model sees the goal on screen", shown.answers?.goal_met?.choice === "yes");
    check(
      "the model doesn't see a goal that isn't there",
      notShown.answers?.goal_met?.choice === "no",
    );
    check("an ordinary page is not a wall", (shown.answers?.wall?.noul ?? 1) < 0.5);
  } else {
    console.log("VISION_URL not set: the model part is skipped.");
  }
} catch (error) {
  check("no unexpected error", false, String(error?.stack ?? error));
} finally {
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
