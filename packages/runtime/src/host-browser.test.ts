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
    [
      "open -a with a named browser",
      { args: { command: 'open -a "Google Chrome" https://example.com' } },
    ],
    ["cmd /c start", { args: { command: "cmd /c start https://example.com" } }],
    [
      "google-chrome on Linux",
      { args: { command: "google-chrome --headless https://example.com" } },
    ],
    ["chromium", { args: { command: "chromium --no-sandbox" } }],
    ["xdg-open a page", { args: { command: "xdg-open index.html" } }],
    [
      "PowerShell Start-Process",
      { args: { command: "powershell -c Start-Process https://example.com" } },
    ],
    ["python webbrowser", { args: { command: "python -m webbrowser https://example.com" } }],
    ["npx playwright", { args: { command: "npx playwright test" } }],
    ["a shell wrapper", { args: { command: 'sh -c "open https://example.com"' } }],
    ["bash -c xdg-open", { args: { command: 'bash -c "xdg-open https://example.com"' } }],
    [
      "powershell -Command",
      { args: { command: 'powershell -NoProfile -Command "Start-Process chrome"' } },
    ],
    ["wslview", { args: { command: "wslview https://example.com" } }],
    ["Invoke-Item", { args: { command: "Invoke-Item index.html" } }],
    ["vite --open", { args: { command: "vite --open" } }],
    ["a dev server that opens the browser", { args: { command: "npm run dev -- --open" } }],
    ["a script running puppeteer", { args: { command: "node scrape-puppeteer.js" } }],
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
    "open README.md",
    "start-server --port 3000",
    "npm install left-pad",
    "git log --oneline -5",
    'git commit -m "open https://example.com in the docs"',
    "npm run dev -- --host 0.0.0.0",
    'sh -c "ls -la && git status"',
  ])("does not mistake %s for a browser launch", (command) => {
    expect(usesHostBrowser(req({ args: { command } }))).toBe(false);
  });
});
