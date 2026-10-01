import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Grok Bot's cap: telemetry never grows past this (the previous file is kept as `.1`). */
export const TELEMETRY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The box's own telemetry: one JSON object per line (component crashes and restarts, sign-in
 * restores, boot stages). Read by Settings > Computer's diagnostics and attached to bug reports.
 */
export class TelemetryLog {
  constructor(
    private readonly file: string | undefined,
    private readonly now: () => Date = () => new Date(),
    private readonly maxBytes = TELEMETRY_MAX_BYTES,
  ) {
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true });
      } catch {
        // Written nowhere, then.
      }
    }
  }

  record<E extends { kind: string }>(event: E): void {
    if (!this.file) return;
    const line = JSON.stringify({ ts: this.now().toISOString(), ...event }) + "\n";
    try {
      if (statSafe(this.file) + line.length > this.maxBytes) {
        renameSync(this.file, `${this.file}.1`);
      }
      appendFileSync(this.file, line, { mode: 0o600 });
    } catch {
      // Telemetry must never break the box.
    }
  }

  /** The newest `limit` events (oldest first). */
  read(limit = 500): Array<Record<string, unknown>> {
    if (!this.file) return [];
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  }
}

function statSafe(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
