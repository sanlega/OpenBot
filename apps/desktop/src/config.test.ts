import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isHarnessUrl, readLocalOwnerKey, withLocalOwnerKey } from "./config.js";

describe("the owner key stays with this app's own pages (D-036)", () => {
  it("recognises the harness by its exact origin, never a prefix", () => {
    expect(isHarnessUrl("http://127.0.0.1:4577/app/", 4577)).toBe(true);
    expect(isHarnessUrl("http://127.0.0.1:45771/app/", 4577)).toBe(false);
    expect(isHarnessUrl("http://127.0.0.1:4577@evil.example/", 4577)).toBe(false);
    expect(isHarnessUrl("http://localhost:4577/app/", 4577)).toBe(false);
    expect(isHarnessUrl(undefined, 4577)).toBe(false);
    expect(isHarnessUrl("not a url", 4577)).toBe(false);
  });

  it("reads the key the harness wrote, and adds it to the event stream's address", () => {
    const home = mkdtempSync(join(tmpdir(), "openbot-desktop-key-"));
    try {
      expect(readLocalOwnerKey(home)).toBeUndefined();
      writeFileSync(join(home, "local-owner.key"), `${"ab".repeat(32)}\n`);
      expect(readLocalOwnerKey(home)).toBe("ab".repeat(32));
      expect(withLocalOwnerKey("ws://127.0.0.1:4577/api/ws", "k")).toBe(
        "ws://127.0.0.1:4577/api/ws?key=k",
      );
      expect(withLocalOwnerKey("ws://x/api/ws", undefined)).toBe("ws://x/api/ws");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
