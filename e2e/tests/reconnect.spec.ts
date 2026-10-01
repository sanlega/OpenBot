import { test, expect } from "@playwright/test";
import { api, createBot, startTestHarness, type TestHarness } from "../src/harness.js";

test.describe("The open app after OpenBot restarts (R3)", () => {
  test("reconnects by itself and new replies stream in again", async ({ page }) => {
    const first = await startTestHarness();
    let harness: TestHarness = first;
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      await createBot(harness, {
        name: "Helper",
        description: "helps with things",
        routing: { mode: "pinned", engine: "fake" },
      });

      await page.goto(`${harness.baseUrl}/app/`);
      await page.getByText("Helper").first().click();
      await page.getByLabel("Message").fill("first question");
      await page.getByRole("button", { name: "Send" }).click();
      const messages = page.getByTestId("thread-messages");
      await expect(messages).toContainText("Sure, I can help with that.");

      // OpenBot goes away (an update, a crash) while the page stays open...
      await harness.stop();
      await expect(page.getByText("Reconnecting to OpenBot…")).toBeVisible({ timeout: 15_000 });

      // ...and comes back on the same address with the same data.
      harness = await startTestHarness({
        home: first.home,
        port: Number(new URL(first.baseUrl).port),
      });
      await expect(page.getByText("Reconnecting to OpenBot…")).toBeHidden({ timeout: 30_000 });

      // The event stream works again: a new turn's reply shows up without reloading the page.
      await page.getByLabel("Message").fill("second question");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(messages).toContainText("second question");
      await expect(messages.getByText("Sure, I can help with that.")).toHaveCount(2, {
        timeout: 15_000,
      });
    } finally {
      await harness.stop();
      await first.close();
    }
  });
});
