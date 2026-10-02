import type { Decision, JevAnswer, JevQuestion } from "@openbot/contracts";
import { JevClient } from "@openbot/decisions";

/** How one replayed question compares with the answer recorded at the time. */
export type QuestionOutcome = "agree" | "disagree" | "missing";

export interface PurposeReport {
  purpose: string;
  decisions: number;
  questions: number;
  agree: number;
  disagree: number;
  /** Questions the provider left out of its answer. */
  missing: number;
  /** Decisions the provider refused (a 4xx: too many options, too long...). */
  refused: number;
  /** Decisions that failed otherwise (timeouts, network). */
  failed: number;
  meanLatencyMs?: number;
  /** Agreement, 0-1, over the questions answered. */
  agreement?: number;
}

export interface CompareOptions {
  url: string;
  key?: string;
  timeoutMs?: number;
  /** Builds the client (tests pass a fake). */
  client?: (url: string, key: string) => Pick<JevClient, "systemOne">;
  onProgress?: (done: number, total: number) => void;
}

/** Same meaning: the same choice, the same side of a yes/no, the same rounded score level. */
export function compareAnswer(recorded: unknown, replayed: JevAnswer | undefined): QuestionOutcome {
  if (!replayed) return "missing";
  const before = recorded as JevAnswer | undefined;
  if (!before || before.type !== replayed.type) return "disagree";
  if (before.type === "choice" && replayed.type === "choice") {
    return before.choice === replayed.choice ? "agree" : "disagree";
  }
  if (before.type === "noul" && replayed.type === "noul") {
    return before.noul >= 0.5 === replayed.noul >= 0.5 ? "agree" : "disagree";
  }
  if (before.type === "score" && replayed.type === "score") {
    return Math.round(before.score) === Math.round(replayed.score) ? "agree" : "disagree";
  }
  return "disagree";
}

/**
 * V2: replays decisions that kept what they saw against another Jev-compatible server and says,
 * per purpose, how often it agrees with what was decided then. Read-only: nothing is recorded.
 */
export async function compareDecisions(
  decisions: Decision[],
  options: CompareOptions,
): Promise<PurposeReport[]> {
  const client = (
    options.client ?? ((url, key) => new JevClient({ baseUrl: url, apiKey: key, maxRetries: 0 }))
  )(options.url, options.key?.trim() || "local");
  const reports = new Map<string, PurposeReport & { latencies: number[] }>();
  const usable = decisions.filter((d) => d.request && Object.keys(d.request.questions).length > 0);
  let done = 0;
  for (const decision of usable) {
    const report =
      reports.get(decision.purpose) ??
      reports
        .set(decision.purpose, {
          purpose: decision.purpose,
          decisions: 0,
          questions: 0,
          agree: 0,
          disagree: 0,
          missing: 0,
          refused: 0,
          failed: 0,
          latencies: [],
        })
        .get(decision.purpose)!;
    report.decisions += 1;
    const questions = decision.request!.questions as Record<string, JevQuestion>;
    try {
      const result = await client.systemOne({
        state: decision.request!.state as never,
        questions,
        timeoutMs: options.timeoutMs ?? 60_000,
      });
      report.latencies.push(result.latencyMs);
      for (const id of Object.keys(questions)) {
        report.questions += 1;
        report[compareAnswer(decision.answers[id], result.response.answers[id])] += 1;
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) {
        report.refused += 1;
      } else {
        report.failed += 1;
      }
    }
    options.onProgress?.(++done, usable.length);
  }
  return [...reports.values()]
    .map(({ latencies, ...r }) => ({
      ...r,
      ...(latencies.length
        ? { meanLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) }
        : {}),
      ...(r.agree + r.disagree > 0 ? { agreement: r.agree / (r.agree + r.disagree) } : {}),
    }))
    .sort((a, b) => b.decisions - a.decisions);
}

/** The report as a table for a terminal. */
export function formatReport(reports: PurposeReport[]): string {
  if (reports.length === 0) {
    return "No decisions have kept what they saw yet. Use OpenBot for a while with Settings > Jev > Keep what each decision saw on, then compare again.";
  }
  const rows = reports.map((r) => [
    r.purpose,
    String(r.decisions),
    r.agreement === undefined ? "-" : `${Math.round(r.agreement * 100)}%`,
    `${r.agree}/${r.agree + r.disagree}`,
    String(r.missing),
    String(r.refused),
    String(r.failed),
    r.meanLatencyMs === undefined ? "-" : `${r.meanLatencyMs} ms`,
  ]);
  const head = [
    "purpose",
    "decisions",
    "agreement",
    "agree",
    "missing",
    "refused",
    "failed",
    "latency",
  ];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(head), ...rows.map(line)].join("\n");
}
