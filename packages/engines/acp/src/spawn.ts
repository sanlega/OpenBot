import { readFileSync } from "node:fs";
import { runCommand } from "@openbot/engines-common";
import { dirname, join } from "node:path";

export interface SpawnTarget {
  command: string;
  /** Arguments that go before the caller's (a script run by Node). */
  prefixArgs: string[];
  /** Only for shims we could not see through: Node refuses to spawn `.cmd` files without a shell. */
  shell: boolean;
}

/**
 * Windows puts npm CLIs behind `.cmd` shims, which Node 22 can only run through a shell (and a
 * shell re-parses every argument). The npm shim names the real target, so run that directly:
 * an `.exe` as is, a `.js` script with this Node.
 */
export function resolveSpawnTarget(command: string): SpawnTarget {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, prefixArgs: [], shell: false };
  }
  try {
    const text = readFileSync(command, "utf8");
    const match = /"%~?dp0%?\\?([^"%]+\.(exe|js|cjs|mjs))"/i.exec(text);
    if (match) {
      const target = join(dirname(command), match[1]!);
      return /\.exe$/i.test(target)
        ? { command: target, prefixArgs: [], shell: false }
        : { command: process.execPath, prefixArgs: [target], shell: false };
    }
  } catch {
    // Fall through to the shell.
  }
  return { command, prefixArgs: [], shell: true };
}

/** `runCommand` through `resolveSpawnTarget`, so npm `.cmd` shims work on Windows. */
export async function runCli(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const target = resolveSpawnTarget(command);
  return runCommand(target.command, [...target.prefixArgs, ...args], options);
}
