/**
 * What a screen says when a request fails: always a plain sentence, never an API path, status
 * code or id. The raw error goes to the console for bug reports.
 */
export function friendlyError(err: unknown, fallback: string): string {
  if (typeof console !== "undefined") console.warn(fallback, err);
  const status = (err as { status?: unknown } | undefined)?.status;
  if (status === 401) return "This device isn't paired with OpenBot any more. Pair it again.";
  if (status === 403) return "Only your own devices can do this.";
  // fetch() throws a TypeError when nothing answers (not every TypeError: a UI bug is one too).
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Can't reach OpenBot right now. Try again in a moment.";
  }
  const reason = serverReason(err);
  return reason ? `${withStop(fallback)} ${reason}` : fallback;
}

/** The server's `{ reason }`, when it is a sentence for people (not a code or a path). */
function serverReason(err: unknown): string | undefined {
  const body = (err as { body?: unknown } | undefined)?.body;
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  if (typeof reason !== "string") return undefined;
  const text = reason.trim();
  if (!text || text.length > 200 || /[/\\{}<>_]|https?:|\b[a-z]+_[a-z]+\b/.test(text)) {
    return undefined;
  }
  return withStop(text.charAt(0).toUpperCase() + text.slice(1));
}

function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
