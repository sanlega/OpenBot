import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test.describe("OpenBot desktop shell", () => {
  test("loads the WS5 UI and survives window close", async () => {
    const openbotHome = await mkdtemp(join(tmpdir(), "openbot-desktop-e2e-"));

    const app = await electron.launch({
      args: [desktopRoot, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
      env: {
        ...process.env,
        OPENBOT_HOME: openbotHome,
        // Runs next to an installed OpenBot: its own profile (lock) and port.
        OPENBOT_DESKTOP_USER_DATA: join(openbotHome, "electron"),
        PORT: String(await freePort()),
        OPENBOT_FAKE_JEV: "1",
        OPENBOT_FAKE_ENGINES: "1",
        OPENBOT_FAKE_COMPUTER: "1",
        OPENBOT_HARNESS_NODE: "1",
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });

    try {
      const window = await app.firstWindow({ timeout: 45_000 });
      // The wizard only shows once the API answered: the window got this install's key (D-036).
      await expect(window.getByTestId("setup-wizard")).toBeVisible({ timeout: 30_000 });
      await window.close();
      expect(app.windows().length).toBe(0);
    } finally {
      await app.close();
      await rm(openbotHome, { recursive: true, force: true });
    }
  });
});
