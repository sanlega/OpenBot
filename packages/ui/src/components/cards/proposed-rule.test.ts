import { describe, expect, it } from "vitest";
import { proposedRule } from "./ApprovalCard.js";

describe("proposedRule (C2)", () => {
  it("is as narrow as what was asked", () => {
    expect(proposedRule("Bash", { command: "git push origin main" }).match).toEqual({
      tool: "Bash",
      args: { command: "git push origin main" },
    });
    expect(proposedRule("Write", { file_path: "/home/me/notes.md", content: "x" }).match).toEqual({
      tool: "Write",
      args: { file_path: "/home/me/notes.md" },
    });
    expect(proposedRule("mcp__linear__create_issue", { title: "x" }).match).toEqual({
      tool: "mcp__linear__create_issue",
    });
  });
});

describe("what Always allow says it allows", () => {
  it("is plain words, never a tool's internal name", () => {
    expect(proposedRule("Bash", { command: "npm test" }).label).toBe(
      "Always allow runs this exact command without asking again.",
    );
    expect(proposedRule("Write", { file_path: "notes.md" }).label).toContain("change notes.md");
    const generic = proposedRule("mcp__linear__create_issue", {}).label;
    expect(generic).not.toMatch(/mcp__|Bash|Write/);
  });
});
