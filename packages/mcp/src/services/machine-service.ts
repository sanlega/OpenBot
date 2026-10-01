import type {
  Action,
  ComputerProvider,
  ExecResult,
  Observation,
  ObservedElement,
  Screen,
} from "@openbot/contracts";
import { loginForUrl, resolveSecretRef, type CoreContext } from "@openbot/core";
import { isSensitiveLabel, type ComputerActionBroker } from "@openbot/computer";
import { classifyToolCall, type Runtime } from "@openbot/runtime";
import type { SessionContext, ToolResult } from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpComputerServiceAdapter } from "./computer-service.js";

/** What a browser tool returns: the page after the step, with refs for the next one. */
export interface PageView {
  url?: string;
  title?: string;
  /** The page's readable text (capped). */
  text?: string;
  /** Controls on screen: pass `ref` to browser_click / browser_type. */
  elements: Array<{ ref: string; role: string; label: string; value?: string }>;
  /** What the step did, when it was an action. */
  did?: string;
}

const PAGE_TEXT_LIMIT = 6000;
const ELEMENT_LIMIT = 80;
const SETTLE_MS = 800;
const NAVIGATE_TIMEOUT_MS = 30_000;
/** Where the shared workspace is inside the machine. */
export const VM_WORKSPACE = "/workspace";
/** Biggest file vm_read_file returns, in characters. */
const READ_FILE_LIMIT = 200_000;
const KEYS = new Set(["Enter", "Escape", "Tab"]);
/** Output characters returned inline by vm_shell; more goes to a file in the machine. */
const SHELL_OUTPUT_INLINE = 12_000;

function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

/**
 * The bot's own hands on its machine (D-033): the browser on its virtual-machine screen, driven
 * step by step by the engine (read the page, click a ref, type), and a shell and files inside the
 * machine. `computer_task` stays for longer flows Jev can run on its own.
 */
export class McpMachineServiceAdapter {
  /** The last page each bot read: refs point into it. */
  private readonly lastRead = new Map<string, Observation>();

  constructor(
    private readonly ctx: CoreContext,
    private readonly computer: McpComputerServiceAdapter,
    private readonly runtime?: Runtime,
  ) {}

  async browserRead(
    session: SessionContext,
    input: { url?: string },
  ): Promise<ToolResult<{ page: PageView }>> {
    const screen = await this.screenFor(session);
    if ("allowed" in screen) return screen;
    let did: string | undefined;
    if (input.url) {
      if (!/^https?:\/\//i.test(input.url))
        return refused("url must start with http:// or https://");
      const opened = await withDeadline(
        screen.act({ op: "navigate", url: input.url }),
        NAVIGATE_TIMEOUT_MS,
      ).catch((error: unknown) => ({ ok: false, reason: messageOf(error) }));
      // A slow page is usually there anyway: read whatever loaded.
      did = opened.ok ? `opened ${input.url}` : `opening ${input.url} was slow (${opened.reason})`;
      await sleep(SETTLE_MS);
    }
    const page = await this.read(session.botId, screen);
    return allowed({ page: { ...page, ...(did ? { did } : {}) } });
  }

  async browserClick(
    session: SessionContext,
    input: { ref: string },
  ): Promise<ToolResult<{ page: PageView }>> {
    return this.onElement(session, input.ref, async (screen, element, observation) => {
      // Opening a link only moves around; the risk is in a control that commits.
      const navigates = /^(a|link|tab|menuitem)$/i.test(element.role);
      const check = await this.check(session, { op: "click", target: element.index }, observation, {
        sensitiveLabel: !navigates && isSensitiveLabel(element.label),
      });
      if (check) return check;
      const result = await screen.act({ op: "click", target: element.index });
      if (!result.ok)
        return refused(result.reason ?? "the click failed", "browser_read and try again");
      return `clicked ${element.role} "${short(element.label)}"`;
    });
  }

  async browserType(
    session: SessionContext,
    input: { ref: string; text: string; submit?: boolean },
  ): Promise<ToolResult<{ page: PageView }>> {
    const secrets: string[] = [];
    const page = await this.onElement(session, input.ref, async (screen, element, observation) => {
      const text = await this.resolveText(input.text, observation.url);
      if (text === undefined) {
        return refused(
          `could not resolve ${input.text.split(":")[0]}: reference`,
          "use a secret: reference from ask_user, or login:username / login:password for a saved login (list_logins)",
        );
      }
      if (text !== input.text) secrets.push(text);
      const action: Action = { op: "type", target: element.index, text };
      const check = await this.check(session, action, observation, {
        sensitiveLabel: isSensitiveLabel(element.label),
      });
      if (check) return check;
      const result = await screen.act(action);
      if (!result.ok)
        return refused(result.reason ?? "typing failed", "browser_read and try again");
      if (input.submit) await screen.act({ op: "key", text: "Enter" });
      return `typed into ${element.role} "${short(element.label)}"${input.submit ? " and pressed Enter" : ""}`;
    });
    return secrets.length > 0 && page.allowed ? { ...page, page: mask(page.page, secrets) } : page;
  }

  async browserKey(
    session: SessionContext,
    input: { key: string },
  ): Promise<ToolResult<{ page: PageView }>> {
    if (!KEYS.has(input.key)) return refused(`key must be one of ${[...KEYS].join(", ")}`);
    return this.simple(session, { op: "key", text: input.key }, `pressed ${input.key}`);
  }

  async browserScroll(
    session: SessionContext,
    input: { direction?: "up" | "down" },
  ): Promise<ToolResult<{ page: PageView }>> {
    const direction = input.direction === "up" ? "up" : "down";
    return this.simple(session, { op: "scroll", text: direction }, `scrolled ${direction}`);
  }

  async vmShell(
    session: SessionContext,
    input: { command: string; cwd?: string; timeoutSeconds?: number },
  ): Promise<ToolResult<{ [K in keyof ExecResult]: ExecResult[K] } & { fullOutput?: string }>> {
    const provider = await this.machine(session);
    if ("allowed" in provider) return provider;
    const denied = await this.permit(session, "vm_shell", "Bash", { command: input.command });
    if (denied) return denied;
    const result = await provider.exec({
      command: input.command,
      cwd: input.cwd ?? VM_WORKSPACE,
      timeoutMs: Math.min(Math.max(input.timeoutSeconds ?? 120, 1), 600) * 1000,
    });
    if (result.stdout.length + result.stderr.length <= SHELL_OUTPUT_INLINE) {
      return allowed({ ...result });
    }
    // A long output goes to a file in the machine; the engine gets its end and where the rest is,
    // instead of filling its context.
    const file = `${VM_WORKSPACE}/.tool-output/${Date.now().toString(36)}.txt`;
    const saved = await provider
      .exec({
        command: `mkdir -p ${quote(`${VM_WORKSPACE}/.tool-output`)} && cat > ${quote(file)}`,
        stdin: result.stderr ? `${result.stdout}\n--- stderr ---\n${result.stderr}` : result.stdout,
        timeoutMs: 30_000,
      })
      .catch(() => undefined);
    return allowed({
      ...result,
      stdout: tail(result.stdout, SHELL_OUTPUT_INLINE / 2),
      stderr: tail(result.stderr, SHELL_OUTPUT_INLINE / 4),
      truncated: true,
      ...(saved?.code === 0 ? { fullOutput: file } : {}),
    });
  }

  async vmReadFile(
    session: SessionContext,
    input: { path: string },
  ): Promise<ToolResult<{ path: string; content: string; truncated: boolean }>> {
    const provider = await this.machine(session);
    if ("allowed" in provider) return provider;
    const path = vmPath(input.path);
    const result = await provider.exec({
      command: `head -c ${READ_FILE_LIMIT + 1} -- ${quote(path)}`,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) return refused(result.stderr.trim() || `cannot read ${path}`);
    const truncated = result.stdout.length > READ_FILE_LIMIT;
    return allowed({ path, content: result.stdout.slice(0, READ_FILE_LIMIT), truncated });
  }

  async vmWriteFile(
    session: SessionContext,
    input: { path: string; content: string },
  ): Promise<ToolResult<{ path: string; bytes: number }>> {
    const provider = await this.machine(session);
    if ("allowed" in provider) return provider;
    const path = vmPath(input.path);
    const denied = await this.permit(session, "vm_write_file", "Write", { file_path: path });
    if (denied) return denied;
    const result = await provider.exec({
      command: `mkdir -p -- "$(dirname -- ${quote(path)})" && cat > ${quote(path)}`,
      stdin: input.content,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) return refused(result.stderr.trim() || `cannot write ${path}`);
    return allowed({ path, bytes: Buffer.byteLength(input.content, "utf8") });
  }

  async vmEditFile(
    session: SessionContext,
    input: { path: string; old_string: string; new_string: string; replace_all?: boolean },
  ): Promise<ToolResult<{ path: string; replacements: number }>> {
    const read = await this.vmReadFile(session, { path: input.path });
    if (!read.allowed) return read;
    if (read.truncated)
      return refused("the file is too big to edit this way", "use vm_shell (sed)");
    const count = read.content.split(input.old_string).length - 1;
    if (count === 0)
      return refused("old_string was not found in the file", "vm_read_file it again");
    if (count > 1 && !input.replace_all) {
      return refused(
        `old_string appears ${count} times`,
        "add surrounding lines to make it unique, or pass replace_all",
      );
    }
    const content = input.replace_all
      ? read.content.split(input.old_string).join(input.new_string)
      : read.content.replace(input.old_string, () => input.new_string);
    const written = await this.vmWriteFile(session, { path: read.path, content });
    if (!written.allowed) return written;
    return allowed({ path: read.path, replacements: input.replace_all ? count : 1 });
  }

  async vmListFiles(
    session: SessionContext,
    input: { path?: string },
  ): Promise<ToolResult<{ path: string; listing: string }>> {
    const provider = await this.machine(session);
    if ("allowed" in provider) return provider;
    const path = vmPath(input.path ?? VM_WORKSPACE);
    const result = await provider.exec({
      command: `ls -la --group-directories-first -- ${quote(path)} | head -n 500`,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) return refused(result.stderr.trim() || `cannot list ${path}`);
    return allowed({ path, listing: result.stdout });
  }

  /** The bot's screen, unless it has no computer or a computer task is driving it right now. */
  private async screenFor(session: SessionContext): Promise<Screen | ToolResult<never>> {
    const bot = this.ctx.repos.bots.getById(session.botId) ?? session.bot;
    if (bot.computer === "none") {
      return refused("this bot has no computer", "the owner can give it one in its profile");
    }
    if (!this.ctx.computerProvider) return refused("no computer is set up");
    const task = this.computer.activeTask(session.botId);
    if (task) {
      return refused(
        `computer task ${task.taskId} is driving this screen (${task.status})`,
        "follow it with computer_status, or computer_cancel it before using the browser yourself",
      );
    }
    await this.ctx.computerProvider.ensureStarted();
    return this.ctx.computerProvider.screen(session.botId);
  }

  /** The machine to run commands in: the virtual machine only, never this computer. */
  private async machine(
    session: SessionContext,
  ): Promise<{ exec: NonNullable<ComputerProvider["exec"]> } | ToolResult<never>> {
    const bot = this.ctx.repos.bots.getById(session.botId) ?? session.bot;
    if (bot.computer === "none") {
      return refused("this bot has no computer", "the owner can give it one in its profile");
    }
    const provider = this.ctx.computerProvider;
    if (!provider?.exec) {
      return refused("this computer cannot run commands for bots (the virtual machine can)");
    }
    await provider.ensureStarted();
    return { exec: (request) => provider.exec!(request) };
  }

  private async read(botId: string, screen: Screen): Promise<PageView> {
    const observation = await screen.observe();
    this.lastRead.set(botId, observation);
    return render(observation);
  }

  /** Acts on an element from the last read: still on the page, or found again by what it is. */
  private async onElement(
    session: SessionContext,
    ref: string,
    act: (
      screen: Screen,
      element: ObservedElement,
      observation: Observation,
    ) => Promise<string | ToolResult<never>>,
  ): Promise<ToolResult<{ page: PageView }>> {
    const screen = await this.screenFor(session);
    if ("allowed" in screen) return screen;
    const before = this.lastRead.get(session.botId);
    const index = /^e(\d+)$/.exec(ref.trim())?.[1];
    const wanted =
      index !== undefined ? before?.elements.find((el) => el.index === Number(index)) : undefined;
    if (!wanted) return refused(`unknown ref ${ref}`, "call browser_read and use a ref from it");
    const now = await screen.observe();
    const same = (el: ObservedElement) => el.role === wanted.role && el.label === wanted.label;
    const atIndex = now.elements.find((el) => el.index === wanted.index);
    const matches = now.elements.filter(same);
    const element =
      atIndex && same(atIndex) ? atIndex : matches.length === 1 ? matches[0] : undefined;
    if (!element) {
      this.lastRead.set(session.botId, now);
      return refused(
        `${ref} ("${short(wanted.label)}") is no longer on the page`,
        "the page changed: use a ref from the page below",
      );
    }
    const outcome = await act(screen, element, now);
    if (typeof outcome !== "string") return outcome;
    await sleep(SETTLE_MS);
    const page = await this.read(session.botId, screen);
    return allowed({ page: { ...page, did: outcome } });
  }

  private async simple(
    session: SessionContext,
    action: Action,
    did: string,
  ): Promise<ToolResult<{ page: PageView }>> {
    const screen = await this.screenFor(session);
    if ("allowed" in screen) return screen;
    if (action.op === "key") {
      const observation = this.lastRead.get(session.botId) ?? (await screen.observe());
      const check = await this.check(session, action, observation, {});
      if (check) return check;
    }
    const result = await screen.act(action);
    if (!result.ok) return refused(result.reason ?? `${action.op} failed`);
    await sleep(action.op === "scroll" ? 300 : SETTLE_MS);
    const page = await this.read(session.botId, screen);
    return allowed({ page: { ...page, did } });
  }

  /** The same checks a computer task's step gets: paying or deleting raises a card. */
  private async check(
    session: SessionContext,
    action: Action,
    observation: Observation,
    flags: { sensitiveLabel?: boolean },
  ): Promise<ToolResult<never> | undefined> {
    const broker: ComputerActionBroker = this.computer.actionBroker();
    const decision = await broker.checkAction({
      botId: session.botId,
      chainId: session.chainId,
      action,
      observation,
      providerId: this.ctx.computerProvider?.id ?? "docker",
      isDestructive: false,
      sensitiveLabel: flags.sensitiveLabel ?? false,
    });
    return decision === "allow" ? undefined : refused("the user did not allow this step");
  }

  /** A command or file write inside the machine, through the bot's permission preset. */
  private async permit(
    session: SessionContext,
    action: string,
    as: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult<never> | undefined> {
    if (!this.runtime) return undefined;
    const classified = classifyToolCall(as, args, VM_WORKSPACE);
    const decision = await this.runtime.broker.evaluate(
      {
        ...classified,
        botId: session.botId,
        chainId: session.chainId,
        kind: "tool",
        action,
        args,
        summary: `${action}: ${String(args.command ?? args.file_path ?? "")}`.slice(0, 200),
        detail: JSON.stringify(args).slice(0, 2000),
      },
      {
        mode: session.mode,
        preset:
          this.ctx.repos.bots.getById(session.botId)?.permissionPreset ??
          session.bot.permissionPreset,
      },
    );
    if (decision.outcome === "allow") return undefined;
    if (decision.outcome === "ask" && decision.approvalId) {
      const resolution = await this.runtime.broker.waitForApproval(decision.approvalId);
      if (resolution === "allow") return undefined;
      return refused("the user did not allow this");
    }
    if (decision.outcome === "simulate") return refused("dry run: not executed");
    return refused(decision.reason ?? "not allowed");
  }

  /** `secret:` references and `login:username|password` become the real value at typing time. */
  private async resolveText(text: string, url: string | undefined): Promise<string | undefined> {
    if (text.startsWith("secret:")) return resolveSecretRef(this.ctx.vault, text);
    const login = /^login:(username|password)$/.exec(text)?.[1] as
      "username" | "password" | undefined;
    if (login) return (await loginForUrl(this.ctx.vault, url))?.[login];
    return text;
  }
}

function render(observation: Observation): PageView {
  return {
    url: observation.url,
    title: observation.title,
    ...(observation.text ? { text: observation.text.slice(0, PAGE_TEXT_LIMIT) } : {}),
    elements: observation.elements.slice(0, ELEMENT_LIMIT).map((el) => ({
      ref: `e${el.index}`,
      role: el.role,
      label: short(el.label.replace(/\s+/g, " ").trim()),
      ...(el.value ? { value: el.value.slice(0, 200) } : {}),
    })),
  };
}

/** A typed secret never comes back in what the engine reads. */
function mask(page: PageView, secrets: string[]): PageView {
  const hide = (text: string) =>
    secrets.reduce((acc, secret) => (secret ? acc.split(secret).join("••••••") : acc), text);
  return {
    ...page,
    ...(page.text ? { text: hide(page.text) } : {}),
    elements: page.elements.map((el) => (el.value ? { ...el, value: hide(el.value) } : el)),
  };
}

/** Paths are inside the machine; a relative one is in the shared workspace. */
export function vmPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("/")) return trimmed;
  return `${VM_WORKSPACE}/${trimmed.replace(/^\.\//, "")}`;
}

/** Single-quotes a value for bash. */
export function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function short(label: string): string {
  return label.length > 100 ? `${label.slice(0, 97)}…` : label;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
