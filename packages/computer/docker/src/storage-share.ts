import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** One browser's open page and what its localStorage holds. */
export interface PageStorage {
  origin: string;
  items: Record<string, string>;
}

/** Reads and writes the localStorage of the page a screen's browser shows (CDP in the container). */
export interface StorageAccess {
  read(debugPort: number): Promise<PageStorage | undefined>;
  /** Sets these keys on the page (only on its own origin). */
  write(debugPort: number, origin: string, items: Record<string, string>): Promise<void>;
  /** Reloads the page, so the app reads the session it was just given. */
  reload(debugPort: number): Promise<void>;
}

/** Grok Bot's breaker: more than 3 reloads of one site in a minute opens the circuit. */
export const RELOADS_PER_MINUTE = 3;
const MAX_VALUE = 100_000;
const MAX_PER_ORIGIN = 1_000_000;

/**
 * B2: many web apps (Notion, Linear, most single-page apps with Auth0 or Firebase) keep the
 * sign-in in localStorage, not in cookies, so sharing cookies is not enough for "signed in on
 * one bot, signed in on all". Before a bot looks at its screen, what any screen's page stored is
 * merged per origin (a value beats an empty one; nothing is ever deleted) and the keys the bot's
 * page is missing are seeded, then the page is reloaded once so the app picks the session up.
 */
export class SharedLocalStorage {
  private readonly origins = new Map<string, Map<string, string>>();
  /** What each browser was already offered (`origin\0key\0value`), so it is not offered again. */
  private readonly offered = new Map<number, Set<string>>();
  private readonly reloads = new Map<string, number[]>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly access: StorageAccess,
    private readonly file?: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  /** Brings `target`'s page up to date with what every screen in `ports` stored. */
  async sync(target: number, ports: number[]): Promise<{ seeded: number; reloaded: boolean }> {
    let targetPage: PageStorage | undefined;
    for (const port of new Set([...ports, target])) {
      const page = await this.access.read(port).catch(() => undefined);
      if (!page) continue;
      if (port === target) targetPage = page;
      this.merge(page);
    }
    if (!targetPage) return { seeded: 0, reloaded: false };
    const known = this.origins.get(targetPage.origin);
    if (!known) return { seeded: 0, reloaded: false };
    const offered = this.offered.get(target) ?? new Set<string>();
    this.offered.set(target, offered);
    const missing: Record<string, string> = {};
    for (const [key, value] of known) {
      const mark = `${targetPage.origin}\0${key}\0${value}`;
      if (offered.has(mark)) continue;
      if (targetPage.items[key]) continue; // the page has its own value: never overwrite it
      missing[key] = value;
      offered.add(mark);
    }
    const seeded = Object.keys(missing).length;
    if (seeded === 0) return { seeded: 0, reloaded: false };
    try {
      await this.access.write(target, targetPage.origin, missing);
    } catch {
      for (const key of Object.keys(missing)) {
        offered.delete(`${targetPage.origin}\0${key}\0${missing[key]}`);
      }
      return { seeded: 0, reloaded: false };
    }
    const reloaded = this.mayReload(targetPage.origin);
    if (reloaded) await this.access.reload(target).catch(() => undefined);
    return { seeded, reloaded };
  }

  /** A browser that restarted (or a screen given to another bot) starts from nothing. */
  forget(port: number): void {
    this.offered.delete(port);
  }

  /** What is known for an origin (tests and diagnostics). */
  itemsFor(origin: string): Record<string, string> {
    return Object.fromEntries(this.origins.get(origin) ?? []);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  private merge(page: PageStorage): void {
    if (!/^https?:\/\//.test(page.origin)) return;
    const known = this.origins.get(page.origin) ?? new Map<string, string>();
    let size = [...known.values()].reduce((n, v) => n + v.length, 0);
    let changed = false;
    for (const [key, value] of Object.entries(page.items)) {
      if (!value || value.length > MAX_VALUE) continue;
      if (known.get(key) === value) continue;
      if (size + value.length > MAX_PER_ORIGIN) continue;
      size += value.length - (known.get(key)?.length ?? 0);
      known.set(key, value);
      changed = true;
    }
    if (known.size > 0) this.origins.set(page.origin, known);
    if (changed) this.scheduleSave();
  }

  private mayReload(origin: string): boolean {
    const now = this.now();
    const recent = (this.reloads.get(origin) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RELOADS_PER_MINUTE) {
      this.reloads.set(origin, recent);
      return false;
    }
    recent.push(now);
    this.reloads.set(origin, recent);
    return true;
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 1_000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const data = Object.fromEntries(
        [...this.origins].map(([origin, items]) => [origin, Object.fromEntries(items)]),
      );
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ origins: data }), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // Losing the saved copy only costs a sign-in after a restart.
    }
  }

  private load(): void {
    if (!this.file) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as {
        origins?: Record<string, Record<string, string>>;
      };
      for (const [origin, items] of Object.entries(saved.origins ?? {})) {
        this.origins.set(origin, new Map(Object.entries(items)));
      }
    } catch {
      // Nothing saved yet.
    }
  }
}
