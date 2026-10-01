import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the desktop app leaves a note that the harness died (read by the next harness, D3). */
export const CRASH_MARKER = "harness-crash.json";

export interface CrashMarker {
  class: "nonzero_exit" | "signal_exit";
  code: number | null;
  startedAt: string;
  exitedAt: string;
  uptimeMs: number;
}

/** Exit code 0 is the harness restarting itself on purpose (to rebind): not a crash. */
export function classifyHarnessExit(code: number | null): CrashMarker["class"] | undefined {
  if (code === 0) return undefined;
  return code === null ? "signal_exit" : "nonzero_exit";
}

/**
 * Writes the crash marker once (an earlier one not yet reported is kept: the first crash says
 * the most). When it cannot be written, says why (a full disk is itself the diagnosis).
 */
export function writeCrashMarker(
  openbotHome: string,
  code: number | null,
  startedAt: number,
  now = Date.now(),
): { written: boolean; reason?: "no_space" | "read_only" | "permission" | "other" } {
  const kind = classifyHarnessExit(code);
  if (!kind) return { written: false };
  const dir = join(openbotHome, "logs");
  const file = join(dir, CRASH_MARKER);
  try {
    if (existsSync(file)) return { written: false };
    mkdirSync(dir, { recursive: true });
    const marker: CrashMarker = {
      class: kind,
      code,
      startedAt: new Date(startedAt).toISOString(),
      exitedAt: new Date(now).toISOString(),
      uptimeMs: Math.max(0, now - startedAt),
    };
    writeFileSync(file, JSON.stringify(marker));
    return { written: true };
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    const reason =
      errno === "ENOSPC"
        ? "no_space"
        : errno === "EROFS"
          ? "read_only"
          : errno === "EACCES" || errno === "EPERM"
            ? "permission"
            : "other";
    console.error(`could not record the harness crash (${reason})`);
    return { written: false, reason };
  }
}
