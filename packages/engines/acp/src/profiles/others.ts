import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCli as runCommand } from "../spawn.js";
import type { AcpProfile } from "../profile.js";

async function versionOf(command: string, args = ["--version"]): Promise<string | undefined> {
  try {
    const { stdout } = await runCommand(command, args, { timeoutMs: 10_000 });
    return stdout.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

/** Cursor's lost-connection diagnostics arrive as the reply text (T3 Code found the same). */
const CURSOR_TRANSPORT =
  /^Error: (?:RetriableError: (?!\[internal\]).+|ConnectError: \[(?:unavailable|aborted|deadline_exceeded)\].*)$/;
const CURSOR_SERVER_ERROR = "Something went wrong communicating with the server. Please try again.";

export function cursorReplyFailure(reply: string): string | undefined {
  const lines = reply
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return undefined;
  const [first, ...rest] = lines;
  const isDiagnostic = CURSOR_TRANSPORT.test(first!) || first === CURSOR_SERVER_ERROR;
  // Only a reply that is nothing but the dump (plus a stack trace); an explanation that quotes
  // one is a real answer.
  if (!isDiagnostic || !rest.every((l) => /^\s+at\s/.test(l))) return undefined;
  return `Cursor lost its connection to Cursor's servers (${first}). Try again in a moment.`;
}

/** Cursor CLI (`cursor-agent acp`), signed in with `cursor-agent login`. */
export function cursorProfile(): AcpProfile {
  return {
    id: "cursor",
    label: "Cursor",
    binaries: ["cursor-agent"],
    loginCommand: "cursor-agent login",
    installUrl: "https://cursor.com/cli",
    summary: "Cursor's agent with the owner's Cursor subscription: strong at coding.",
    authMethodId: "cursor_login",
    async detect(command) {
      try {
        const { stdout, code } = await runCommand(command, ["about", "--format", "json"], {
          timeoutMs: 15_000,
        });
        if (code === 0) {
          const about = JSON.parse(stdout) as { cliVersion?: string; userEmail?: string | null };
          const email = typeof about.userEmail === "string" ? about.userEmail.trim() : "";
          return {
            version: about.cliVersion,
            login: { ok: Boolean(email), ...(email ? { account: email } : {}) },
          };
        }
      } catch {
        // Older CLI: fall back to `status`.
      }
      const version = await versionOf(command);
      try {
        const { stdout } = await runCommand(command, ["status"], { timeoutMs: 15_000 });
        return { version, login: { ok: !/not (logged|signed) in/i.test(stdout) } };
      } catch {
        return { version, login: { ok: false } };
      }
    },
    async listModels() {
      // Cursor lists its models inside a session (the `model` option); they are learned then.
      return [{ id: "auto", label: "Cursor Auto" }];
    },
    async launch() {
      return { args: ["acp"], env: {}, systemPrompt: "prompt" };
    },
    replyFailure: cursorReplyFailure,
  };
}

/** Gemini CLI in ACP mode. Signs in on its first interactive run, or with `GEMINI_API_KEY`. */
export function geminiProfile(): AcpProfile {
  return {
    id: "gemini",
    label: "Gemini CLI",
    binaries: ["gemini"],
    loginCommand: "gemini",
    installUrl: "https://github.com/google-gemini/gemini-cli",
    summary: "Google's Gemini agent: long context, good at research and reading large codebases.",
    async detect(command) {
      const version = await versionOf(command);
      const signedIn =
        Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ||
        existsSync(join(homedir(), ".gemini", "oauth_creds.json"));
      return { version, login: { ok: signedIn } };
    },
    async listModels() {
      return [{ id: "default", label: "Gemini default" }];
    },
    async launch(input) {
      const model = input.model && input.model !== "default" && input.model !== "auto";
      return {
        args: [...(model ? ["-m", input.model] : []), "--experimental-acp"],
        env: {},
        systemPrompt: "prompt",
      };
    },
  };
}

/** xAI's Grok Build CLI (`grok agent stdio`), signed in with `grok login`. */
export function grokProfile(): AcpProfile {
  return {
    id: "grok",
    label: "Grok Build",
    binaries: ["grok"],
    loginCommand: "grok login",
    installUrl: "https://x.ai/cli",
    summary: "xAI's Grok agent with the owner's xAI account.",
    async detect(command) {
      const version = await versionOf(command);
      try {
        // `grok models` reports the sign-in state without starting an agent.
        const { stdout, stderr, code } = await runCommand(command, ["models"], {
          timeoutMs: 15_000,
        });
        const text = `${stdout}\n${stderr}`;
        return {
          version,
          login: { ok: code === 0 && !/not (logged|signed) in|grok login/i.test(text) },
        };
      } catch {
        return { version, login: { ok: false } };
      }
    },
    async listModels(command) {
      try {
        const { stdout, code } = await runCommand(command, ["models"], { timeoutMs: 15_000 });
        if (code !== 0) return [];
        return stdout
          .split(/\r?\n/)
          .map(
            (l) =>
              l
                .trim()
                .replace(/^[-*•]\s*/, "")
                .split(/\s+/)[0] ?? "",
          )
          .filter((id) => /^grok[\w.:-]*$/i.test(id))
          .map((id) => ({ id, label: id }));
      } catch {
        return [];
      }
    },
    async launch() {
      return { args: ["agent", "stdio"], env: {}, systemPrompt: "prompt" };
    },
  };
}

export interface CustomAcpEngine {
  /** Lowercase slug; the engine id is `acp-<slug>`. */
  slug: string;
  label: string;
  command: string;
  args: string[];
}

/** Any other ACP agent the owner adds by command line (Goose, Qwen Code, Copilot CLI...). */
export function customProfile(engine: CustomAcpEngine): AcpProfile {
  return {
    id: `acp-${engine.slug}`,
    label: engine.label,
    binaries: [engine.command],
    summary: `${engine.label} (an ACP agent the owner added).`,
    async detect(command) {
      return { version: await versionOf(command), login: { ok: true } };
    },
    async listModels() {
      return [];
    },
    async launch() {
      return { args: engine.args, env: {}, systemPrompt: "prompt" };
    },
  };
}
