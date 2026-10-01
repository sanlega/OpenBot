import { test, expect } from "@playwright/test";
import { api, startTestHarness } from "../src/harness.js";

test.describe("Only the owner opens OpenBot on this computer (D-036)", () => {
  test("loopback alone is not the owner: the install's key is", async ({ page }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      // Another program (or another account) that only knows the address.
      const stranger = await fetch(`${harness.baseUrl}/api/bots`);
      expect(stranger.status).toBe(401);
      const wrong = await api(harness, "/api/bots", {
        headers: { "x-openbot-local-key": "0".repeat(64) },
      });
      expect(wrong.status).toBe(401);
      // OpenBot's own app carries the key.
      expect((await api(harness, "/api/bots")).status).toBe(200);

      // The app without its key says how to open it, not "can't reach".
      await page.goto(`${harness.baseUrl}/app/`);
      await expect(page.getByText("This device isn't paired")).toBeVisible();
      await expect(page.getByText(/openbot serve/)).toBeVisible();

      // The printed link opens it, drops the key from the address bar, and a reload still works.
      await page.goto(harness.appUrl);
      await expect(page.getByTestId("bot-list")).toContainText("Chief of Staff");
      expect(page.url()).not.toContain("key=");
      await page.reload();
      await expect(page.getByTestId("bot-list")).toContainText("Chief of Staff");
    } finally {
      await harness.close();
    }
  });
});
