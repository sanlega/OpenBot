import { describe, expect, it } from "vitest";
import type { BrokerRequest } from "./broker-types.js";
import { builtinDenyReason, usesHostBrowser } from "./rules.js";

function req(overrides: Partial<BrokerRequest>): BrokerRequest {
  return {
    botId: "bot_a",
    chainId: "chn_a",
    kind: "tool",
    action: "Bash",
    summary: "Permission prompt",
    detail: "",
    computerAccess: "docker",
    ...overrides,
  };
}

const chromeWindows = String.raw`"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless`;

describe("a Bot whose computer is the virtual machine stays off the host's browser", () => {
  it.each([
    [
      "a Playwright connector tool",
      {
        kind: "connector_action" as const,
        action: "browser_navigate",
        summary: "Playwright browser: browser_navigate",
      },
    ],
    ["a browser_* tool from another server", { action: "mcp__x__browser_click" }],
    ["opening a URL from the shell", { args: { command: "start https://example.com" } }],
    ["launching chrome by path", { args: { command: chromeWindows } }],
    [
      "launching msedge after another command",
      { args: { command: "cd x && msedge --new-window" } },
    ],
    ["opening a URL on macOS", { args: { command: "open https://example.com" } }],
  ])("denies %s", (_name, overrides) => {
    const reason = builtinDenyReason(req(overrides));
    expect(reason).toMatch(/virtual machine.*computer_task/);
  });

  it("does not deny the same tool for a Bot that also has local computer access", () => {
    expect(
      builtinDenyReason(req({ computerAccess: "docker+local", action: "browser_navigate" })),
    ).toBeUndefined();
  });

  it("does not enforce anything when the request doesn't say which computer the Bot has", () => {
    expect(
      builtinDenyReason(req({ computerAccess: undefined, action: "browser_navigate" })),
    ).toBeUndefined();
  });

  it.each([
    "grep -r chrome docs && git status",
    "npm run build",
    "python -m http.server 8934",
    "curl -sL https://example.com/file.jpg -o file.jpg",
    "echo openbot > notes.txt",
  ])("does not mistake %s for a browser launch", (command) => {
    expect(usesHostBrowser(req({ args: { command } }))).toBe(false);
  });
});
