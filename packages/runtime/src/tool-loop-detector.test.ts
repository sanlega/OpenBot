import { describe, expect, it } from "vitest";
import {
  bareToolName,
  loopReminder,
  normaliseToolOutput,
  ToolLoopDetector,
  type LoopDetection,
} from "./tool-loop-detector.js";

describe("ToolLoopDetector (C1)", () => {
  it("flags the same call with the same result, ignoring times and ids", () => {
    const seen: LoopDetection[] = [];
    const d = new ToolLoopDetector("on", (x) => seen.push(x));
    const out = (t: string) =>
      `total 4\n-rw-r--r-- 1 box box 10 Oct  1 ${t} notes.md\nrequest 0a1b2c3d4e5f60718293a4b5`;
    expect(d.observe("t1", "vm_shell", { command: "ls -l" }, out("10:01"))).toBe("none");
    expect(d.observe("t1", "vm_shell", { command: "ls -l" }, out("10:02"))).toBe("retry_once");
    expect(d.observe("t1", "vm_shell", { command: "ls -l" }, out("10:03"))).toBe("loop_reminder");
    expect(seen.map((s) => [s.tool, s.repetitions, s.action])).toEqual([
      ["vm_shell", 2, "retry_once"],
      ["vm_shell", 3, "loop_reminder"],
    ]);
  });

  it("a different input or a different result is progress", () => {
    const d = new ToolLoopDetector("on");
    d.observe("t1", "browser_read", { url: "a" }, "page A");
    expect(d.observe("t1", "browser_read", { url: "b" }, "page A")).toBe("none");
    expect(d.observe("t1", "browser_read", { url: "b" }, "page B")).toBe("none");
    // Separate turns never mix.
    expect(d.observe("t2", "browser_read", { url: "b" }, "page B")).toBe("none");
  });

  it("tolerates tools that repeat by nature, and retries a tool asked for", () => {
    const d = new ToolLoopDetector("on");
    for (let i = 1; i < 4; i++) expect(d.observe("t", "browser_scroll", {}, "same")).toBe("none");
    expect(d.observe("t", "browser_scroll", {}, "same")).toBe("retry_once");

    const r = new ToolLoopDetector("on");
    r.observe("t", "vm_shell", { command: "x" }, "network error, try again");
    expect(r.observe("t", "vm_shell", { command: "x" }, "network error, try again")).toBe("none");
  });

  it("shadow mode records but never acts", () => {
    const seen: LoopDetection[] = [];
    const d = new ToolLoopDetector("shadow", (x) => seen.push(x));
    d.observe("t", "Bash", { command: "ls" }, "a");
    expect(d.observe("t", "Bash", { command: "ls" }, "a")).toBe("none");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.mode).toBe("shadow");
  });

  it("normalises volatile text and tool names", () => {
    expect(normaliseToolOutput("at 2026-10-01T10:00:00Z took 350 ms id: abc")).toBe(
      "at <ts> took <dur> id:<id>",
    );
    expect(bareToolName("mcp__openbot__browser_read")).toBe("browser_read");
    expect(loopReminder("loop_reminder", 3)).toContain("3 times");
  });
});
