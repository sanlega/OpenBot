import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bundle = fileURLToPath(new URL("../dist/desktop-daemon.js", import.meta.url));

/**
 * The daemon runs from an esbuild bundle inside the image: a CommonJS dependency (ws) once made
 * it crash at start-up ("Dynamic require of events") while every unit test passed on the
 * sources. CI builds before testing, so the real bundle is started here.
 */
describe.skipIf(!existsSync(bundle))("desktop daemon bundle", () => {
  it("starts and answers /health", async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn(process.execPath, [bundle], {
      env: {
        ...process.env,
        OPENBOT_CONTROL_PORT: String(port),
        OPENBOT_CONTROL_TOKEN: "t0ken-for-test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    try {
      let status = 0;
      for (let i = 0; i < 50 && status !== 200; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { authorization: "Bearer t0ken-for-test" },
        })
          .then((r) => r.status)
          .catch(() => 0);
      }
      expect(status, output).toBe(200);
    } finally {
      child.kill();
    }
  });
});
