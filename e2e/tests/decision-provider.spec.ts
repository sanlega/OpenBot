import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { api, startTestHarness } from "../src/harness.js";

test.describe("Settings > Jev > Decision model (D-037)", () => {
  test("switch to hybrid with a local server: check it, save it, and the key stays secret", async ({
    page,
  }) => {
    // A Jev-compatible decision server, like laya-serve.
    const seen: Array<{ auth?: string; body: string }> = [];
    const local = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "laya-multilingual",
            answers: { sky: { type: "noul", noul: 0.98 } },
          }),
        );
      });
    });
    await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
    const localUrl = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      await page.goto(harness.appUrl);
      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await page.getByRole("button", { name: "Jev", exact: true }).first().click();

      await page.getByRole("radio", { name: "Hybrid" }).click();
      await expect(page.getByRole("button", { name: "Save decision model" })).toBeDisabled();
      await page.getByLabel("Your decision server").fill(localUrl);
      await page.getByLabel("Server key").fill("k-e2e");
      await page.getByRole("button", { name: "Check decision server" }).click();
      await expect(
        page.getByText(/laya-multilingual answered in \d+ ms, and got the test/),
      ).toBeVisible();
      // The key typed in the form is what the check used.
      expect(seen[0]!.auth).toBe("Bearer k-e2e");

      await page.getByRole("button", { name: "Save decision model" }).click();
      await expect(page.getByText("Saved. New decisions use it now.")).toBeVisible();

      const settings = await api<{ settings: { decisions?: Record<string, unknown> } }>(
        harness,
        "/api/settings",
      );
      expect(settings.body.settings.decisions).toMatchObject({ mode: "hybrid", localUrl });
      // The key went to the vault, never into the settings.
      expect(JSON.stringify(settings.body)).not.toContain("k-e2e");
      const key = await api<{ saved: boolean }>(harness, "/api/decisions/local-key");
      expect(key.body.saved).toBe(true);

      // After a reload the choice is still there.
      await page.reload();
      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
      await page.getByRole("button", { name: "Jev", exact: true }).first().click();
      await expect(page.getByRole("radio", { name: "Hybrid" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByLabel("Your decision server")).toHaveValue(localUrl);
    } finally {
      await harness.close();
      local.close();
    }
  });
});
