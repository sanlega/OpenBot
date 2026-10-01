import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The file, in OpenBot's home, that holds this install's local owner key. */
export const LOCAL_OWNER_KEY_FILE = "local-owner.key";

/** The header OpenBot's own app sends it in (and `?key=` on the event stream). */
export const LOCAL_OWNER_KEY_HEADER = "x-openbot-local-key";

/**
 * D-036: on this computer, being on 127.0.0.1 is not enough to be the owner: a request must also
 * carry this install's key. It lives in a file only the owner's account can read; the desktop app
 * hands it to its own window, `openbot serve` prints a link with it. Other accounts on the same
 * computer, and a page or a tool that only knows the address, are not the owner.
 */
export async function loadOrCreateLocalOwnerKey(openbotHome: string): Promise<string> {
  const path = join(openbotHome, LOCAL_OWNER_KEY_FILE);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // Not created yet.
  }
  const key = randomBytes(32).toString("hex");
  await writeFile(path, `${key}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return key;
}

/** Constant-time comparison of a presented key with this install's. */
export function localOwnerKeyMatches(expected: string, presented: unknown): boolean {
  if (typeof presented !== "string") return false;
  const given = Buffer.from(presented, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  // Byte lengths, not characters: a 64-character header with non-ASCII would make
  // timingSafeEqual throw.
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
