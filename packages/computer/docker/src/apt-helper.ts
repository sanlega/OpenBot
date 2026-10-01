import { spawn } from "node:child_process";
import { chmodSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";

/** Debian package names (optionally `name=version` or `name:arch`); nothing a shell could read as more. */
const PACKAGE_RE = /^[a-z0-9][a-z0-9+.-]{0,99}(:[a-z0-9-]{1,20})?(=[A-Za-z0-9.+:~-]{1,60})?$/;
const MAX_PACKAGES = 30;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const LISTS_FRESH_MS = 60 * 60_000;
const MAX_OUTPUT = 20_000;

/** The package names in a request, or the reason it is refused. */
export function parsePackages(body: unknown): { packages: string[] } | { error: string } {
  const list = (body as { packages?: unknown } | null)?.packages;
  if (!Array.isArray(list) || list.length === 0) return { error: "no packages named" };
  if (list.length > MAX_PACKAGES) return { error: `at most ${MAX_PACKAGES} packages at once` };
  const packages: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !PACKAGE_RE.test(item)) {
      return { error: `not a package name: ${String(item).slice(0, 80)}` };
    }
    packages.push(item);
  }
  return { packages };
}

export type RunCommand = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ code: number | null; output: string }>;

const runCommand: RunCommand = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(file, args, {
      env: { ...minimalEnv(), DEBIAN_FRONTEND: "noninteractive" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

function minimalEnv(): NodeJS.ProcessEnv {
  return { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" };
}

/**
 * Installs system packages for the bots (run as root by the daemon). Only `install` exists: a
 * bot can add tools to its machine, not remove the desktop's own packages.
 */
export class PackageInstaller {
  private listsUpdatedAt: number | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly run: RunCommand = runCommand,
    private readonly now: () => number = Date.now,
  ) {}

  install(packages: string[]): Promise<{ code: number | null; output: string }> {
    // One apt at a time: dpkg holds a lock, and two bots installing at once must both succeed.
    const job = this.queue.then(() => this.installNow(packages));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async installNow(packages: string[]) {
    if (this.listsUpdatedAt === undefined || this.now() - this.listsUpdatedAt > LISTS_FRESH_MS) {
      const update = await this.run("/usr/bin/apt-get", ["update", "-q"], INSTALL_TIMEOUT_MS);
      if (update.code !== 0) return update;
      this.listsUpdatedAt = this.now();
    }
    return this.run(
      "/usr/bin/apt-get",
      ["install", "-y", "-q", "--no-install-recommends", ...packages],
      INSTALL_TIMEOUT_MS,
    );
  }
}

/** Serves package installs on a local socket the bot user can reach (and nothing else). */
export function startPackageHelper(socketPath: string, installer = new PackageInstaller()): Server {
  try {
    if (statSync(socketPath).isSocket()) rmSync(socketPath, { force: true });
  } catch {
    // Not there yet.
  }
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/install") {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = undefined;
      }
      const parsed = parsePackages(body);
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if ("error" in parsed)
        return reply(400, { code: 2, output: `openbot-apt: ${parsed.error}\n` });
      installer.install(parsed.packages).then(
        (result) => reply(200, result),
        (error: unknown) => reply(500, { code: 1, output: String(error) }),
      );
    });
  });
  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o666);
    } catch {
      // The bot user then cannot install system packages; everything else still works.
    }
  });
  server.on("error", (error) => console.error("package helper:", error));
  return server;
}
