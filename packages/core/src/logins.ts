import type { Vault } from "./vault.js";

/**
 * Saved website logins. The owner types them once (or a Bot asks for them through a `secret` form
 * field); they live only in the vault, and the host types them into the virtual machine. The Bot
 * that needs a login only ever sees the site and the username, never the password.
 */
export const LOGIN_VAULT_PREFIX = "login.";
const SECRET_REF_PREFIX = "secret:";

export interface StoredLogin {
  username?: string;
  password?: string;
  updatedAt: string;
}

/** What may be shown to anyone: no password. */
export interface LoginSummary {
  site: string;
  username?: string;
  hasPassword: boolean;
  updatedAt: string;
}

type LoginVault = Pick<Vault, "get" | "set" | "delete" | "list">;

/** `https://www.LinkedIn.com/login?x=1` → `linkedin.com`; undefined when it isn't a hostname. */
export function siteKey(input: string): string | undefined {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : undefined;
}

/** A page's own host, then its parent domains: `accounts.example.com` tries `example.com` too. */
export function siteCandidates(url: string | undefined): string[] {
  if (!url) return [];
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return [];
  }
  const parts = host.split(".");
  const out: string[] = [];
  for (let i = 0; i <= parts.length - 2; i += 1) out.push(parts.slice(i).join("."));
  return out;
}

export async function resolveSecretRef(
  vault: LoginVault,
  ref: string,
): Promise<string | undefined> {
  if (!ref.startsWith(SECRET_REF_PREFIX)) return ref;
  return vault.get(ref.slice(SECRET_REF_PREFIX.length));
}

/** Saves (or updates) the login for a site. Values may be plain text or `secret:` references. */
export async function saveLogin(
  vault: LoginVault,
  site: string,
  values: { username?: string; password?: string },
  now: Date,
): Promise<{ ok: true; site: string } | { ok: false; reason: string }> {
  const key = siteKey(site);
  if (!key) return { ok: false, reason: `"${site}" isn't a website address like example.com` };
  const previous = await getLogin(vault, key);
  const username = values.username
    ? await resolveSecretRef(vault, values.username)
    : previous?.username;
  const password = values.password
    ? await resolveSecretRef(vault, values.password)
    : previous?.password;
  if (!username && !password) return { ok: false, reason: "a username or a password is needed" };
  const stored: StoredLogin = { username, password, updatedAt: now.toISOString() };
  await vault.set(`${LOGIN_VAULT_PREFIX}${key}`, JSON.stringify(stored));
  return { ok: true, site: key };
}

export async function getLogin(vault: LoginVault, site: string): Promise<StoredLogin | undefined> {
  const key = siteKey(site);
  if (!key) return undefined;
  const raw = await vault.get(`${LOGIN_VAULT_PREFIX}${key}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredLogin;
  } catch {
    return undefined;
  }
}

/** The saved login that applies to a page URL, if any. */
export async function loginForUrl(
  vault: LoginVault,
  url: string | undefined,
): Promise<StoredLogin | undefined> {
  for (const candidate of siteCandidates(url)) {
    const login = await getLogin(vault, candidate);
    if (login) return login;
  }
  return undefined;
}

export async function listLogins(vault: LoginVault): Promise<LoginSummary[]> {
  const keys = (await vault.list()).filter((key) => key.startsWith(LOGIN_VAULT_PREFIX));
  const out: LoginSummary[] = [];
  for (const key of keys) {
    const site = key.slice(LOGIN_VAULT_PREFIX.length);
    const login = await getLogin(vault, site);
    if (login) {
      out.push({
        site,
        username: login.username,
        hasPassword: Boolean(login.password),
        updatedAt: login.updatedAt,
      });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

export async function removeLogin(vault: LoginVault, site: string): Promise<boolean> {
  const key = siteKey(site);
  if (!key || !(await vault.get(`${LOGIN_VAULT_PREFIX}${key}`))) return false;
  await vault.delete(`${LOGIN_VAULT_PREFIX}${key}`);
  return true;
}

/** Whether a field is asking for a password or for who you are, from what the page calls it. */
export function loginFieldKind(label: string, role?: string): "password" | "username" | undefined {
  if (role === "password" || /pass(word|code)?\b|contrase(ñ|n)a|clave/i.test(label)) {
    return "password";
  }
  if (/e-?mail|user ?name|usuario|correo|log ?in|phone|tel[eé]fono|identifier/i.test(label)) {
    return "username";
  }
  return undefined;
}
