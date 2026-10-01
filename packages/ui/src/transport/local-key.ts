/** D-036: the header OpenBot's own app sends this computer's owner key in. */
export const LOCAL_KEY_HEADER = "X-OpenBot-Local-Key";

const STORAGE_KEY = "openbot.localKey";

/**
 * This computer's owner key, when this page is OpenBot's own app on the computer running it:
 * the desktop app hands it over through its preload; `openbot serve` prints a link ending in
 * `#key=…`, kept here (and removed from the address bar) so a reload still works.
 */
export function localOwnerKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const desktop = (window as { openbot?: { getLocalOwnerKey?: () => unknown } }).openbot;
  const fromDesktop = desktop?.getLocalOwnerKey?.();
  if (typeof fromDesktop === "string" && fromDesktop) return fromDesktop;
  const fromLink = /(?:^#|&)key=([0-9a-f]{64})(?:&|$)/.exec(window.location.hash)?.[1];
  if (fromLink) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromLink);
    } catch {
      // Private window: the key still works for this visit.
    }
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      // Not allowed here; harmless.
    }
    return fromLink;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
