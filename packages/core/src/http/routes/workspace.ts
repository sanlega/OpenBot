import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireOwner } from "../auth.js";

/** Characters of a file shown in the panel; bigger files show their beginning. */
export const PREVIEW_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;

/**
 * The real path of `rel` inside the workspace, or undefined when it would leave it (`..`, an
 * absolute path, or a symlink pointing outside).
 */
export async function insideWorkspace(root: string, rel: string): Promise<string | undefined> {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (isAbsolute(cleaned) || cleaned.split("/").includes("..")) return undefined;
  let realRoot: string;
  let target: string;
  try {
    realRoot = await realpath(root);
    target = await realpath(join(root, cleaned));
  } catch {
    return undefined;
  }
  const back = relative(realRoot, target);
  const leaves = back === ".." || back.startsWith(`..${sep}`) || back.startsWith("../");
  return leaves || isAbsolute(back) ? undefined : target;
}

/** Recent `vm_shell` commands per bot (N2), from the event bus. */
interface CommandEntry {
  command: string;
  at: string;
  toolUseId?: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

/**
 * N2: the workspace (the folder shared with the VM, at /workspace inside it) and each bot's latest
 * VM commands, for the Computer tab's Files panel. Read-only, and only inside the workspace.
 */
export function registerWorkspaceRoutes(app: FastifyInstance, ctx: CoreContext): void {
  const commands = new Map<string, CommandEntry[]>();
  ctx.eventBus.subscribe((event) => {
    if (!event.botId) return;
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "tool.started" && /(^|__)vm_shell$/.test(String(payload.toolName ?? ""))) {
      const input = (payload.input ?? {}) as { command?: unknown };
      if (typeof input.command !== "string") return;
      const list = commands.get(event.botId) ?? [];
      list.unshift({
        command: input.command.slice(0, 2_000),
        at: event.ts,
        ...(typeof payload.toolUseId === "string" ? { toolUseId: payload.toolUseId } : {}),
      });
      commands.set(event.botId, list.slice(0, 30));
    } else if (event.type === "tool.completed" && typeof payload.toolUseId === "string") {
      const entry = commands.get(event.botId)?.find((c) => c.toolUseId === payload.toolUseId);
      if (!entry) return;
      const output = parseOutput(payload.output);
      if (output) {
        entry.exitCode = output.code;
        entry.timedOut = output.timedOut;
      }
    }
  });

  app.get("/api/workspace/files", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { path = "" } = request.query as { path?: string };
    const dir = await insideWorkspace(ctx.config.workspaceDir, path);
    if (!dir) return reply.code(404).send({ error: "not_found", reason: "no such folder" });
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return reply.code(404).send({ error: "not_found", reason: "not a folder" });
    }
    const entries = (
      await Promise.all(
        names.slice(0, MAX_ENTRIES).map(async (name) => {
          try {
            const s = await stat(join(dir, name));
            return {
              name,
              kind: s.isDirectory() ? ("dir" as const) : ("file" as const),
              size: s.size,
              modifiedAt: s.mtime.toISOString(),
            };
          } catch {
            return undefined;
          }
        }),
      )
    )
      .filter((e) => e !== undefined)
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
      );
    return {
      path: path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
      entries,
      more: names.length > MAX_ENTRIES,
    };
  });

  app.get("/api/workspace/file", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { path = "" } = request.query as { path?: string };
    const file = await insideWorkspace(ctx.config.workspaceDir, path);
    if (!file) return reply.code(404).send({ error: "not_found", reason: "no such file" });
    let size: number;
    try {
      const s = await stat(file);
      if (!s.isFile()) return reply.code(404).send({ error: "not_found", reason: "not a file" });
      size = s.size;
    } catch {
      return reply.code(404).send({ error: "not_found", reason: "no such file" });
    }
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(Math.min(size, PREVIEW_BYTES));
      await handle.read(buffer, 0, buffer.length, 0);
      const binary = buffer.includes(0);
      return {
        path,
        size,
        binary,
        truncated: size > PREVIEW_BYTES,
        ...(binary ? {} : { text: buffer.toString("utf8") }),
      };
    } finally {
      await handle.close();
    }
  });

  app.get("/api/bots/:id/commands", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { id } = request.params as { id: string };
    return { commands: (commands.get(id) ?? []).map(({ toolUseId: _id, ...rest }) => rest) };
  });
}

function parseOutput(output: unknown): { code: number | null; timedOut: boolean } | undefined {
  let value = output;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  // MCP results arrive as { content: [{ text: "<json>" }] } from some engines.
  const content = (value as { content?: Array<{ text?: string }> } | null)?.content;
  if (Array.isArray(content) && typeof content[0]?.text === "string") {
    try {
      value = JSON.parse(content[0].text);
    } catch {
      return undefined;
    }
  }
  const v = value as { code?: unknown; timedOut?: unknown } | null;
  if (!v || !("code" in v)) return undefined;
  return { code: typeof v.code === "number" ? v.code : null, timedOut: v.timedOut === true };
}
