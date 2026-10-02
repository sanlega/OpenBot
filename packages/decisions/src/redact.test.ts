import { describe, expect, it } from "vitest";
import { DecisionLog, InMemoryDecisionLog } from "./decision-log.js";
import { MAX_STORED_REQUEST_CHARS, redactSecrets, storableRequest } from "./redact.js";

describe("what decisions keep of their requests (V1)", () => {
  it("never keeps secrets: secret-named fields and credential shapes in text", () => {
    const out = JSON.stringify(
      redactSecrets({
        password: "hunter2",
        login: { apiKey: "abc", user: "ana@example.com" },
        page: "Authorization: Bearer abcdefghijklmnop and sk-ant-0123456789abcdefghij",
        note: "token ts_live_abcdef123456 ghp_0123456789abcdefghijABCDEFGHIJ",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnop",
      }),
    );
    for (const secret of [
      "hunter2",
      '"abc"',
      "abcdefghijklmnop",
      "sk-ant-",
      "ts_live_",
      "ghp_",
      "eyJhbG",
    ]) {
      expect(out, secret).not.toContain(secret);
    }
    // Ordinary content stays readable.
    expect(out).toContain("ana@example.com");
  });

  it("caps a huge state but always keeps the questions", () => {
    const questions = { done: { type: "noul", instructions: "Is it done?" } };
    const kept = storableRequest({ page: "x".repeat(200_000) }, questions);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_STORED_REQUEST_CHARS);
    expect(kept.questions).toEqual(questions);
    expect(kept.state).toMatchObject({ truncated: true });
  });

  it("stores the request only while the owner keeps them", () => {
    const store = new InMemoryDecisionLog();
    let keep = true;
    const log = new DecisionLog(store, { keepRequests: () => keep });
    const input = {
      purpose: "risk" as const,
      provider: "jev" as const,
      model: "jev-1",
      state: { command: "rm -rf build", token: "secret-value" },
      questions: { risky: { type: "noul" as const, instructions: "Risky?" } },
      answers: { risky: { type: "noul" as const, noul: 0.2 } },
    };
    log.record(input);
    keep = false;
    log.record(input);
    expect(store.entries[0]!.request).toEqual({
      state: { command: "rm -rf build", token: "[redacted]" },
      questions: input.questions,
    });
    expect(store.entries[1]!.request).toBeUndefined();
  });
});
