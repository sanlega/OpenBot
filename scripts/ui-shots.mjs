// Screenshots of UI states for a visual review (not the README set): the mock Client API with its
// seed data, the built PWA. Output: $SHOTS_DIR (default ./ui-shots).
//   pnpm build && node scripts/ui-shots.mjs
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../e2e/node_modules/@playwright/test/index.mjs";
import { MockClientApiServer } from "../packages/ui/dist/mock/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(root, "apps/pwa/static");
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), "ui-shots");
await mkdir(OUT, { recursive: true });
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" };

const { url } = await new MockClientApiServer().listen();
const browser = await chromium.launch();

async function shot(name, steps, { width = 1280, height = 800, scheme = "dark" } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
  await page.route(`${url}/app/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/app\/?/, "") || "index.html";
    const file = await readFile(join(STATIC, path)).catch(() => readFile(join(STATIC, "index.html")));
    await route.fulfill({ body: file, contentType: TYPES[extname(path)] ?? "text/html" });
  });
  page.on("pageerror", (e) => console.error(`${name}: ${e.message}`));
  await page.goto(`${url}/app/`);
  await page.waitForTimeout(1000);
  try {
    await steps(page);
  } catch (error) {
    console.error(`${name}: ${error.message}`);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.close();
  console.log(join(OUT, `${name}.png`));
}

const rows = (p) => p.getByTestId("bot-list").locator(".bot-row");
await shot("01-sidebar-hover", async (p) => {
  await rows(p).nth(1).hover();
});
await shot("02-menu-open", async (p) => {
  await rows(p).nth(1).click({ button: "right" });
});
await shot("03-rename", async (p) => {
  await rows(p).nth(1).click({ button: "right" });
  await p.getByRole("menuitem", { name: "Rename" }).click();
});
await shot("04-delete-confirm", async (p) => {
  await rows(p).nth(1).click({ button: "right" });
  await p.getByRole("menuitem", { name: "Delete bot" }).click();
});
await shot("05-settings-data", async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Data", exact: true }).click();
});
await shot("06-settings-clear-all", async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Data", exact: true }).click();
  await p.getByRole("button", { name: "Clear all…" }).click();
});
await shot("07-menu-light", async (p) => {
  await rows(p).nth(1).click({ button: "right" });
}, { scheme: "light" });
await shot("08-phone-delete", async (p) => {
  await rows(p).nth(1).locator(".bot-row-more").click();
  await p.getByRole("menuitem", { name: "Delete bot" }).click();
}, { width: 390, height: 844 });

await browser.close();
process.exit(0);
