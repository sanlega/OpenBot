import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";
import { insideWorkspace } from "./workspace.js";

let t: TestContext | undefined;
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  await t?.cleanup();
  app = undefined;
  t = undefined;
});

describe("workspace files (N2)", () => {
  it("lists folders first, previews text, and says when a file is not text", async () => {
    t = await createTestContext();
    const ws = t.ctx.config.workspaceDir;
    mkdirSync(join(ws, "reports"), { recursive: true });
    writeFileSync(join(ws, "notes.md"), "# Notes\nhello");
    writeFileSync(join(ws, "reports", "data.bin"), Buffer.from([1, 0, 2, 3]));
    app = await buildServer(t.ctx);

    const root = (await app.inject({ method: "GET", url: "/api/workspace/files" })).json();
    expect(root.entries.map((e: { name: string; kind: string }) => `${e.kind}:${e.name}`)).toEqual([
      "dir:reports",
      "file:notes.md",
    ]);
    const note = (
      await app.inject({ method: "GET", url: "/api/workspace/file?path=notes.md" })
    ).json();
    expect(note).toMatchObject({ binary: false, text: "# Notes\nhello", truncated: false });
    const bin = (
      await app.inject({ method: "GET", url: "/api/workspace/file?path=reports/data.bin" })
    ).json();
    expect(bin).toMatchObject({ binary: true });
    expect(bin.text).toBeUndefined();
  });

  it("never leaves the workspace, by .. or by a symlink", async () => {
    t = await createTestContext();
    const ws = t.ctx.config.workspaceDir;
    const outside = mkdtempSync(join(tmpdir(), "openbot-outside-"));
    writeFileSync(join(outside, "secret.txt"), "nope");
    let linked = false;
    try {
      symlinkSync(outside, join(ws, "escape"), "junction");
      linked = true;
    } catch {
      // Symlinks may need privileges on this machine; the .. checks still run.
    }
    app = await buildServer(t.ctx);
    for (const path of ["../", "..%2F..%2Fetc", "/etc/passwd", "C:%5CWindows"]) {
      const res = await app.inject({ method: "GET", url: `/api/workspace/file?path=${path}` });
      expect(res.statusCode, path).toBe(404);
    }
    // A repeated ?path= is not an error page.
    expect(
      (await app.inject({ method: "GET", url: "/api/workspace/files?path=a&path=b" })).statusCode,
    ).toBe(404);
    if (linked) {
      // Listed as a link, without the details of what it points to.
      const listed = (await app.inject({ method: "GET", url: "/api/workspace/files" })).json();
      expect(listed.entries).toContainEqual(
        expect.objectContaining({ name: "escape", kind: "link", size: 0, target: "outside" }),
      );
      expect(await insideWorkspace(ws, "escape/secret.txt")).toBeUndefined();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspace/file?path=escape/secret.txt",
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("a link inside the workspace opens as what it points to", async () => {
    t = await createTestContext();
    const ws = t.ctx.config.workspaceDir;
    mkdirSync(join(ws, "reports"), { recursive: true });
    writeFileSync(join(ws, "reports", "a.md"), "# A");
    try {
      symlinkSync(join(ws, "reports"), join(ws, "latest"), "junction");
    } catch {
      return; // no link privileges on this machine
    }
    app = await buildServer(t.ctx);
    const listed = (await app.inject({ method: "GET", url: "/api/workspace/files" })).json();
    expect(listed.entries).toContainEqual(
      expect.objectContaining({ name: "latest", kind: "link", target: "dir" }),
    );
    const inside = (
      await app.inject({ method: "GET", url: "/api/workspace/file?path=latest/a.md" })
    ).json();
    expect(inside).toMatchObject({ text: "# A" });
  });

  it("keeps each bot's latest VM commands with how they ended", async () => {
    t = await createTestContext();
    app = await buildServer(t.ctx);
    await t.ctx.eventBus.publish({
      type: "tool.started",
      botId: "bot_a",
      payload: {
        toolName: "mcp__openbot__vm_shell",
        toolUseId: "u1",
        input: { command: "npm test" },
      },
    });
    await t.ctx.eventBus.publish({
      type: "tool.completed",
      botId: "bot_a",
      payload: {
        toolUseId: "u1",
        output: JSON.stringify({ code: 1, timedOut: false }),
        isError: false,
      },
    });
    const res = (await app.inject({ method: "GET", url: "/api/bots/bot_a/commands" })).json();
    expect(res.commands).toEqual([
      expect.objectContaining({ command: "npm test", exitCode: 1, timedOut: false }),
    ]);
  });
});
