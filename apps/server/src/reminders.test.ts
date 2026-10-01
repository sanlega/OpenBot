import { describe, expect, it } from "vitest";
import { steerText, withReminders } from "./reminders.js";

describe("harness reminders (C4)", () => {
  it("go before the text, marked as the harness's", () => {
    expect(withReminders("hello", [])).toBe("hello");
    const text = withReminders("hello", ["Your previous turn was interrupted."]);
    expect(text).toMatch(
      /^<system_reminder>\n- Your previous turn was interrupted\.\n<\/system_reminder>\n\nhello$/,
    );
  });

  it("a steered message tells the engine to follow it first and then finish", () => {
    expect(steerText("stop the build")).toMatch(/Follow it first[\s\S]*stop the build$/);
  });
});
