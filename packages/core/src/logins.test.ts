import { describe, expect, it } from "vitest";
import {
  listLogins,
  loginFieldKind,
  loginForUrl,
  removeLogin,
  resolveSecretRef,
  saveLogin,
  siteCandidates,
  siteKey,
} from "./logins.js";
import { InMemoryVault } from "./vault.js";

const NOW = new Date("2026-09-30T10:00:00Z");

describe("saved logins", () => {
  it("normalizes a site to its host", () => {
    expect(siteKey("https://www.LinkedIn.com/login?x=1")).toBe("linkedin.com");
    expect(siteKey("linkedin.com")).toBe("linkedin.com");
    expect(siteKey("not a site")).toBeUndefined();
    expect(siteKey("localhost")).toBeUndefined();
  });

  it("tries a page's host and then its parent domains", () => {
    expect(siteCandidates("https://accounts.www.example.com/login")).toEqual([
      "accounts.www.example.com",
      "www.example.com",
      "example.com",
    ]);
    expect(siteCandidates("https://www.example.com/")).toEqual(["example.com"]);
    expect(siteCandidates(undefined)).toEqual([]);
  });

  it("stores a login, finds it for any page of the site, and never lists the password", async () => {
    const vault = new InMemoryVault();
    const saved = await saveLogin(
      vault,
      "https://www.example.com",
      {
        username: "me@example.com",
        password: "hunter2",
      },
      NOW,
    );
    expect(saved).toEqual({ ok: true, site: "example.com" });

    const found = await loginForUrl(vault, "https://accounts.example.com/signin");
    expect(found).toMatchObject({ username: "me@example.com", password: "hunter2" });

    const listed = await listLogins(vault);
    expect(listed).toEqual([
      {
        site: "example.com",
        username: "me@example.com",
        hasPassword: true,
        updatedAt: NOW.toISOString(),
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("hunter2");
  });

  it("resolves secret: references from the vault when saving", async () => {
    const vault = new InMemoryVault();
    await vault.set("input.abc.password", "s3cret");
    const saved = await saveLogin(
      vault,
      "example.com",
      { username: "me", password: "secret:input.abc.password" },
      NOW,
    );
    expect(saved.ok).toBe(true);
    expect((await loginForUrl(vault, "https://example.com"))?.password).toBe("s3cret");
    expect(await resolveSecretRef(vault, "secret:input.abc.password")).toBe("s3cret");
    expect(await resolveSecretRef(vault, "plain text")).toBe("plain text");
  });

  it("keeps the old password when only the username changes", async () => {
    const vault = new InMemoryVault();
    await saveLogin(vault, "example.com", { username: "a", password: "pw" }, NOW);
    await saveLogin(vault, "example.com", { username: "b" }, NOW);
    expect(await loginForUrl(vault, "https://example.com")).toMatchObject({
      username: "b",
      password: "pw",
    });
  });

  it("rejects an invalid site and an empty login", async () => {
    const vault = new InMemoryVault();
    expect((await saveLogin(vault, "nope", { username: "a" }, NOW)).ok).toBe(false);
    expect((await saveLogin(vault, "example.com", {}, NOW)).ok).toBe(false);
  });

  it("removes a login", async () => {
    const vault = new InMemoryVault();
    await saveLogin(vault, "example.com", { username: "a" }, NOW);
    expect(await removeLogin(vault, "example.com")).toBe(true);
    expect(await removeLogin(vault, "example.com")).toBe(false);
    expect(await listLogins(vault)).toEqual([]);
  });

  it.each([
    ["Password", undefined, "password"],
    ["Contraseña", undefined, "password"],
    ["anything", "password", "password"],
    ["Email or phone", undefined, "username"],
    ["Usuario", undefined, "username"],
    ["Search", undefined, undefined],
  ])("classifies the field %s (%s) as %s", (label, role, kind) => {
    expect(loginFieldKind(label, role)).toBe(kind);
  });
});
