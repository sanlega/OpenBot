/** The language of every word in the UI, dates included (a weekday or month in another
 * language next to English words reads oddly). */
export const UI_LOCALE = "en";

/** The owner's own clock (12 or 24 hours), kept even though the words are English. */
const USER_HOUR_CYCLE = (() => {
  try {
    return new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions().hourCycle;
  } catch {
    return undefined;
  }
})();

/** A date (and time) in the UI's language, with the owner's clock. */
export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const hasTime = options.timeStyle !== undefined || options.hour !== undefined;
  return d.toLocaleString(
    UI_LOCALE,
    hasTime && USER_HOUR_CYCLE ? { hourCycle: USER_HOUR_CYCLE, ...options } : options,
  );
}

/** "14:02" today, "Yesterday", weekday within a week, else "27 Sep". */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (d.getTime() >= startOfToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (d.getTime() >= startOfToday - day) return "Yesterday";
  if (d.getTime() >= startOfToday - 6 * day) {
    return formatDate(d, { weekday: "short" });
  }
  return formatDate(d, { day: "numeric", month: "short" });
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Yesterday", or a full date, for day separators in a thread. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - 86_400_000) return "Yesterday";
  return formatDate(d, { weekday: "long", day: "numeric", month: "long" });
}

export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}
