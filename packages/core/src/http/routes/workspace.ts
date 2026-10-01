import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
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

/** `?path=` as one string (a repeated parameter arrives as an array). */
function queryPath(query: unknown): string {
  const value = (query as { path?: unknown } | undefined)?.path;
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
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
    const path = queryPath(request.query);
    const dir = await insideWorkspace(ctx.config.workspaceDir, path);
    if (!dir) return reply.code(404).send({ error: "not_found", reason: "no such folder" });
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return reply.code(404).send({ error: "not_found", reason: "not a folder" });
    }
    names.sort((a, b) => a.localeCompare(b));
    const entries = (
      await Promise.all(
        names.slice(0, MAX_ENTRIES).map(async (name) => {
          try {
            // lstat: a link shows as a link, never with the details of what it points to.
            const s = await lstat(join(dir, name));
            const link = s.isSymbolicLink();
            // What a link opens as: only a link that stays inside the workspace opens at all.
            let target: "dir" | "file" | "outside" | undefined;
            if (link) {
              const real = await insideWorkspace(
                ctx.config.workspaceDir,
                path ? `${path}/${name}` : name,
              );
              const t = real ? await stat(real).catch(() => undefined) : undefined;
              target = t?.isDirectory() ? "dir" : t?.isFile() ? "file" : "outside";
            }
            return {
              ...(target ? { target } : {}),
              name,
              kind: link
                ? ("link" as const)
                : s.isDirectory()
                  ? ("dir" as const)
                  : ("file" as const),
              size: link ? 0 : s.size,
              modifiedAt: s.mtime.toISOString(),
            };
          } catch {
            return undefined;
          }
        }),
      )
    )
      .filter((e) => e !== undefined)
      // Folders first, then the rest by name.
      .sort((a, b) =>
        (a.kind === "dir") === (b.kind === "dir")
          ? a.name.localeCompare(b.name)
          : a.kind === "dir"
            ? -1
            : 1,
      );
    return {
      path: path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
      entries,
      more: names.length > MAX_ENTRIES,
    };
  });

  app.get("/api/workspace/file", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const path = queryPath(request.query);
    const file = await insideWorkspace(ctx.config.workspaceDir, path);
    if (!file) return reply.code(404).send({ error: "not_found", reason: "no such file" });
    let size: number;
    let checked: { dev: bigint; ino: bigint };
    try {
      const s = await stat(file, { bigint: true });
      if (!s.isFile()) return reply.code(404).send({ error: "not_found", reason: "not a file" });
      size = Number(s.size);
      checked = { dev: s.dev, ino: s.ino };
    } catch {
      return reply.code(404).send({ error: "not_found", reason: "no such file" });
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(file, "r");
    } catch {
      // Locked or unreadable: a plain answer, never an error page with local paths.
      return reply.code(409).send({ error: "unreadable", reason: "this file can't be opened now" });
    }
    // The file actually opened must be the one checked inside the workspace: a path component
    // swapped for a link between the check and the open opens something else, refused.
    const opened = await handle.stat({ bigint: true }).catch(() => undefined);
    if (!opened || opened.dev !== checked.dev || opened.ino !== checked.ino) {
      await handle.close();
      return reply.code(404).send({ error: "not_found", reason: "no such file" });
    }
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
