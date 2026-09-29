import { describe, expect, it } from "vitest";
import type { ObservationResult, ShellExec } from "@openbot/computer/observation";
import { DisplaySessionManager } from "./display-session.js";

const searchPage: ObservationResult = {
  url: "https://www.youtube.com/",
  title: "YouTube",
  elements: [
    { index: 0, role: "a", label: "Home" },
    { index: 1, role: "input", label: "Search", value: "" },
  ],
  _meta: [
    { index: 0, role: "a", label: "Home", bounds: { x: 0, y: 0, width: 40, height: 20 } },
    { index: 1, role: "input", label: "Search", bounds: { x: 400, y: 10, width: 200, height: 30 } },
  ],
};

function setup(navigateOk = true) {
  const commands: string[] = [];
  const navigations: string[] = [];
  const pageActions: string[] = [];
  const shell: ShellExec = {
    run: async (cmd, args) => {
      commands.push([cmd, ...args].join(" "));
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const sessions = new DisplaySessionManager({
    shell,
    startDisplay: async () => undefined,
    observePage: async () => searchPage,
    navigateTab: async (_port, url) => {
      navigations.push(url);
      return navigateOk;
    },
    pageInput: {
      click: async (_port, x, y) => {
        pageActions.push(`click ${x},${y}`);
        return true;
      },
      typeInto: async (_port, x, y, text) => {
        pageActions.push(`type ${x},${y} ${text}`);
        return true;
      },
      press: async (_port, key) => {
        pageActions.push(`press ${key}`);
        return true;
      },
    },
  });
  return { sessions, commands, navigations, pageActions };
}

describe("DisplaySessionManager", () => {
  it("types into the chosen field itself, in page coordinates", async () => {
    const { sessions, commands, pageActions } = setup();
    await sessions.observe("bot_1");

    const result = await sessions.act("bot_1", { op: "type", target: 1, text: "sanlega" });

    expect(result.ok).toBe(true);
    expect(pageActions).toEqual(["type 500,25 sanlega"]);
    expect(commands).toEqual([]);
  });

  it("clicks inside the page, not at screen coordinates", async () => {
    const { sessions, commands, pageActions } = setup();
    await sessions.observe("bot_1");

    await sessions.act("bot_1", { op: "click", target: 0 });

    expect(pageActions).toEqual(["click 20,10"]);
    expect(commands).toEqual([]);
  });

  it("refuses to type into an element it never observed", async () => {
    const { sessions, commands } = setup();
    await sessions.observe("bot_1");

    const result = await sessions.act("bot_1", { op: "type", target: 7, text: "x" });

    expect(result.ok).toBe(false);
    expect(commands).toEqual([]);
  });

  it("presses keys inside the page", async () => {
    const { sessions, commands, pageActions } = setup();
    await sessions.act("bot_1", { op: "key", text: "Enter" });
    expect(pageActions).toEqual(["press Enter"]);
    expect(commands).toEqual([]);
  });

  it("navigates in the current tab instead of opening a new one", async () => {
    const { sessions, navigations } = setup();

    const result = await sessions.act("bot_1", {
      op: "navigate",
      url: "https://www.youtube.com/results?search_query=sanlega",
    });

    expect(result.ok).toBe(true);
    expect(navigations).toEqual(["https://www.youtube.com/results?search_query=sanlega"]);
  });
});

describe("DisplaySessionManager when a display fails to start", () => {
  it("forgets the failed display so the next request starts a fresh one", async () => {
    let starts = 0;
    const sessions = new DisplaySessionManager({
      shell: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      startDisplay: async () => {
        starts += 1;
        if (starts === 1) throw new Error("VNC server on port 5901 did not become ready");
      },
      observePage: async () => searchPage,
    });

    await expect(sessions.observe("bot_1")).rejects.toThrow(/VNC server/);
    // The same rejected start must not be served again: a second call retries.
    const observation = await sessions.observe("bot_1");
    expect(observation.title).toBe("YouTube");
    expect(starts).toBe(2);
  });
});
