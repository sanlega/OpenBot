import { afterEach, describe, expect, it } from "vitest";
import type { ComputerProvider, DecisionService, ExecResult } from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { createRuntime, InMemoryEventSink } from "@openbot/runtime";
import { FakeClock } from "@openbot/testkit";
import { saveLogin } from "@openbot/core";
import { createMcpTestHarness, issueToken, makeBot } from "../test-helpers.js";
import { McpComputerServiceAdapter } from "./computer-service.js";
import { McpMachineServiceAdapter, quote, vmPath } from "./machine-service.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

const quietJev = {
  decide: async () => ({ answers: {}, provider: "jev", model: "t", latencyMs: 1, decisionId: "d" }),
  band: () => "auto",
} as unknown as DecisionService;

/** The fake computer plus a fake machine shell that records every command. */
function providerWithShell(run: (command: string, stdin?: string) => ExecResult) {
  const fake = new FakeComputerProvider();
  const commands: Array<{ command: string; cwd?: string; stdin?: string }> = [];
  const provider: ComputerProvider = {
    id: "docker",
    status: () => fake.status(),
    ensureStarted: () => fake.ensureStarted(),
    screen: (botId) => fake.screen(botId),
    exec: async (request) => {
      commands.push(request);
      return run(request.command, request.stdin);
    },
  };
  return { provider, commands };
}

const ok = (stdout = ""): ExecResult => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
  truncated: false,
});

async function setup(
  options: {
    computer?: "docker" | "none";
    run?: (command: string, stdin?: string) => ExecResult;
  } = {},
) {
  harness = await createMcpTestHarness();
  const { provider, commands } = providerWithShell(options.run ?? (() => ok()));
  harness.ctx.decisionService = quietJev;
  harness.ctx.computerProvider = provider;
  const runtime = createRuntime({
    decisions: quietJev,
    drivers: {},
    clock: new FakeClock(0),
    events: new InMemoryEventSink(),
  });
  const computer = new McpComputerServiceAdapter(harness.ctx, runtime);
  harness.services.computer = computer;
  harness.services.machine = new McpMachineServiceAdapter(harness.ctx, computer, runtime);
  const bot = makeBot({
    name: "Web",
    slug: "web",
    computer: options.computer ?? "docker",
    permissionPreset: "full",
  });
  harness.ctx.repos.bots.create(bot);
  const h = harness;
  const call = <T = Record<string, unknown>>(tool: string, payload: Record<string, unknown>) =>
    h.app
      .inject({
        method: "POST",
        url: `/internal/tools/${tool}`,
        headers: { "x-openbot-session": issueToken(h, bot) },
        payload,
      })
      .then((r) => r.json<{ allowed: boolean; reason?: string } & T>());
  return { call, commands, bot };
}

type Page = {
  page: {
    url?: string;
    title?: string;
    did?: string;
    elements: Array<{ ref: string; role: string; label: string; value?: string }>;
  };
};

describe("browser tools", () => {
  it("reads a page with refs, clicks one and returns the next page", async () => {
    const { call } = await setup();
    const read = await call<Page>("browser_read", {});
    expect(read.allowed).toBe(true);
    expect(read.page.url).toBe("https://fake.local/inbox");
    const compose = read.page.elements.find((el) => el.label === "Compose")!;
    expect(compose.ref).toBe("e0");

    const clicked = await call<Page>("browser_click", { ref: compose.ref });
    expect(clicked).toMatchObject({ allowed: true });
    expect(clicked.page.url).toBe("https://fake.local/compose");
    expect(clicked.page.did).toContain('clicked link "Compose"');
  });

  it("opens a url before reading", async () => {
    const { call } = await setup();
    const read = await call<Page>("browser_read", { url: "https://fake.local/compose" });
    expect(read.page.title).toBe("New message");
    expect(read.page.did).toBe("opened https://fake.local/compose");
  });

  it("refuses a ref that is not on the page any more", async () => {
    const { call, bot } = await setup();
    await call<Page>("browser_read", {}); // the inbox: e3 is "Refresh"
    // Something else moved the screen (the user, a computer task) without a new read.
    const screen = await harness!.ctx.computerProvider!.screen(bot.id);
    await screen.act({ op: "navigate", url: "https://fake.local/compose" });
    const stale = await call("browser_click", { ref: "e3" }); // compose's e3 is "Send"
    expect(stale).toMatchObject({ allowed: false });
    expect(stale.reason).toContain("no longer on the page");
    const unknown = await call("browser_click", { ref: "e99" });
    expect(unknown.reason).toContain("unknown ref e99");
  });

  it("types a saved login without ever returning it", async () => {
    const { call } = await setup();
    await saveLogin(
      harness!.ctx.vault,
      "fake.local",
      { username: "ada", password: "s3cret-pass" },
      new Date(),
    );
    await call<Page>("browser_read", { url: "https://fake.local/compose" });
    const typed = await call<Page>("browser_type", { ref: "e1", text: "login:password" });
    expect(typed.allowed).toBe(true);
    expect(JSON.stringify(typed)).not.toContain("s3cret-pass");
  });

  it("is not offered to a bot without a computer", async () => {
    const { call } = await setup({ computer: "none" });
    const read = await call("browser_read", {});
    expect(read).toMatchObject({ allowed: false });
    expect(read.reason).toContain("no computer");
  });
});

describe("virtual machine shell and files", () => {
  it("runs a command in /workspace inside the machine", async () => {
    const { call, commands } = await setup({ run: () => ok("hello\n") });
    const result = await call<ExecResult>("vm_shell", { command: "echo hello" });
    expect(result).toMatchObject({ allowed: true, code: 0, stdout: "hello\n" });
    expect(commands[0]).toMatchObject({ command: "echo hello", cwd: "/workspace" });
  });

  it("writes a file through stdin, in the workspace for relative paths", async () => {
    const { call, commands } = await setup();
    const result = await call("vm_write_file", { path: "notes/todo.md", content: "- a\n" });
    expect(result).toMatchObject({ allowed: true, path: "/workspace/notes/todo.md", bytes: 4 });
    expect(commands[0]!.stdin).toBe("- a\n");
    expect(commands[0]!.command).toContain("'/workspace/notes/todo.md'");
  });

  it("edits a file only when the text to replace is unique", async () => {
    let file = "a b a";
    const { call } = await setup({
      run: (command, stdin) => {
        if (command.startsWith("head")) return ok(file);
        if (stdin !== undefined) file = stdin;
        return ok();
      },
    });
    const twice = await call("vm_edit_file", { path: "f.txt", old_string: "a", new_string: "c" });
    expect(twice).toMatchObject({ allowed: false });
    const once = await call("vm_edit_file", { path: "f.txt", old_string: "b", new_string: "c" });
    expect(once).toMatchObject({ allowed: true, replacements: 1 });
    expect(file).toBe("a c a");
  });

  it("refuses when the computer has no machine to run commands in", async () => {
    harness = await createMcpTestHarness();
    harness.ctx.computerProvider = new FakeComputerProvider();
    const computer = new McpComputerServiceAdapter(harness.ctx);
    harness.services.machine = new McpMachineServiceAdapter(harness.ctx, computer);
    const bot = makeBot({ name: "Ops", slug: "ops", computer: "docker" });
    harness.ctx.repos.bots.create(bot);
    const response = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/vm_shell",
      headers: { "x-openbot-session": issueToken(harness, bot) },
      payload: { command: "ls" },
    });
    expect(response.json()).toMatchObject({ allowed: false });
  });
});

describe("paths and quoting", () => {
  it("keeps absolute paths and puts relative ones in the workspace", () => {
    expect(vmPath("/tmp/x")).toBe("/tmp/x");
    expect(vmPath("./a/b")).toBe("/workspace/a/b");
  });

  it("quotes for bash, including single quotes", () => {
    expect(quote("it's")).toBe(`'it'\\''s'`);
  });
});
