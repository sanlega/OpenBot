import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One route that worked on a site. */
export interface PlaybookEntry {
  goal: string;
  /** Where the task started, and the page it ended on (the deep link worth starting from). */
  startUrl?: string;
  endUrl?: string;
  /** What was done, in order (clicks and typing on named controls). */
  steps: string[];
  /** Steps a person had to do (a sign-in, a code). */
  needed: string[];
  at: string;
}

/** Routes kept per site; older ones drop off. */
const ENTRIES_PER_SITE = 5;
/** Characters of playbook handed to an engine. */
export const PLAYBOOK_TEXT_LIMIT = 2_500;

export function playbookHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * C9: site playbooks learned from tasks that worked. Discovering a route costs many steps;
 * following a known one costs few (Wikipedia in 2 steps, YouTube in 3-4). Each finished task on
 * a site leaves the deep link it ended on and the steps that worked in
 * `<workspace>/.openbot/playbooks/<site>.md`; the next task on that site gets them.
 */
export class PlaybookStore {
  constructor(private readonly dir: string) {}

  /** The playbook of a site, as markdown for an engine (undefined when none). */
  read(url: string | undefined): string | undefined {
    const host = playbookHost(url);
    if (!host) return undefined;
    const entries = this.entries(host);
    if (entries.length === 0) return undefined;
    const text = render(host, entries);
    return text.length > PLAYBOOK_TEXT_LIMIT ? `${text.slice(0, PLAYBOOK_TEXT_LIMIT)}…` : text;
  }

  record(entry: PlaybookEntry): void {
    const host = playbookHost(entry.endUrl) ?? playbookHost(entry.startUrl);
    if (!host || entry.steps.length === 0) return;
    const entries = [entry, ...this.entries(host).filter((e) => e.goal !== entry.goal)].slice(
      0,
      ENTRIES_PER_SITE,
    );
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = this.file(host);
      writeFileSync(`${file}.json.tmp`, JSON.stringify({ host, entries }, null, 2));
      renameSync(`${file}.json.tmp`, `${file}.json`);
      // The readable copy, for the user and for bots browsing the workspace.
      writeFileSync(`${file}.md`, render(host, entries));
    } catch {
      // A playbook is a shortcut, never required.
    }
  }

  private entries(host: string): PlaybookEntry[] {
    try {
      const saved = JSON.parse(readFileSync(`${this.file(host)}.json`, "utf8")) as {
        entries?: PlaybookEntry[];
      };
      return saved.entries ?? [];
    } catch {
      return [];
    }
  }

  private file(host: string): string {
    return join(this.dir, host.replace(/[^a-z0-9.-]/g, "_"));
  }
}

function render(host: string, entries: PlaybookEntry[]): string {
  const lines = [
    `# Playbook: ${host}`,
    "Routes that worked here before. Start from the deep link when the goal matches; stop and ask when a step needs the user.",
  ];
  for (const e of entries) {
    lines.push("", `## ${e.goal}`, `- learned ${e.at.slice(0, 10)}`);
    if (e.endUrl) lines.push(`- deep link (where it ended): ${e.endUrl}`);
    if (e.startUrl && e.startUrl !== e.endUrl) lines.push(`- started at: ${e.startUrl}`);
    if (e.steps.length) lines.push(`- steps: ${e.steps.join(" → ")}`);
    if (e.needed.length) lines.push(`- needed the user for: ${e.needed.join("; ")}`);
  }
  return lines.join("\n");
}
