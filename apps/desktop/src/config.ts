import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4577;
export const PROTOCOL = "openbot";
export const APP_NAME = "OpenBot";

export function defaultOpenbotHome(): string {
  return process.env.OPENBOT_HOME ?? join(homedir(), ".openbot");
}

/**
 * D-036: this install's owner key, which the harness writes on its first start. The app sends it
 * on its own requests (and hands it to its own window); undefined until the harness made it.
 */
export function readLocalOwnerKey(openbotHome: string): string | undefined {
  try {
    const key = readFileSync(join(openbotHome, "local-owner.key"), "utf8").trim();
    return /^[0-9a-f]{64}$/.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A page of this app's harness: the exact origin, never a prefix (127.0.0.1:45771 or
 * 127.0.0.1:4577@elsewhere would pass a startsWith check).
 */
export function isHarnessUrl(url: string | undefined, port = DEFAULT_PORT): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(harnessBaseUrl(port)).origin;
  } catch {
    return false;
  }
}

/** The event stream's address with the owner key (a WebSocket can't carry it in a header). */
export function withLocalOwnerKey(url: string, key: string | undefined): string {
  return key ? `${url}${url.includes("?") ? "&" : "?"}key=${key}` : url;
}

export function harnessBaseUrl(port = DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export function harnessWsUrl(port = DEFAULT_PORT): string {
  return `ws://127.0.0.1:${port}/api/ws`;
}
