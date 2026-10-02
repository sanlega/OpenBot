import { describe, expect, it, vi } from "vitest";
import type { DecideRequest, DecisionService, DecisionSettings } from "@openbot/contracts";
import { DecisionLog, InMemoryDecisionLog } from "./decision-log.js";
import { FakeDecisionService } from "./fake-decision-service.js";
import {
  answerProblem,
  LOCAL_UNAVAILABLE_MODEL,
  onJevConfidence,
  onJevScale,
  RoutedDecisionService,
  suitsLocal,
  VISION_BANDS,
  VISION_UNAVAILABLE_MODEL,
} from "./routed-decision-service.js";

const gate: DecideRequest = {
  purpose: "risk",
  state: { command: "rm -rf build" },
  questions: { external_side_effect: { type: "noul", instructions: "Side effects outside?" } },
};

const wide: DecideRequest = {
  purpose: "computer",
  state: { goal: "open settings" },
  questions: {
    action: {
      type: "choice",
      instructions: "Next?",
      criteria: Object.fromEntries(
        Array.from({ length: 24 }, (_, i) => [`el_${i}`, `element ${i}`]),
      ),
    },
  },
};

function setup(settings: DecisionSettings, local: (call: unknown) => Promise<unknown>) {
  const jev = new FakeDecisionService();
  const jevDecide = vi.spyOn(jev, "decide");
  const store = new InMemoryDecisionLog();
  const calls: unknown[] = [];
  const service = new RoutedDecisionService({
    jev: jev as DecisionService,
    settings: () => settings,
    log: new DecisionLog(store, { keepRequests: () => true }),
    client: () => ({
      systemOne: async (call: unknown) => {
        calls.push(call);
        return (await local(call)) as never;
      },
    }),
  });
  return { service, jevDecide, store, calls };
}

const localYes = async () => ({
  response: {
    model: "laya-multilingual",
    answers: { external_side_effect: { type: "noul", noul: 0.98 } },
  },
  latencyMs: 30,
});

describe("RoutedDecisionService (D-037)", () => {
  it("jev mode never touches the local server", async () => {
    const { service, jevDecide, calls } = setup(
      { keepRequests: true, mode: "jev", localUrl: "http://127.0.0.1:8000" },
      localYes,
    );
    await service.decide(gate);
    expect(jevDecide).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
  });

  it("hybrid sends small gates to the local model and wide or computer questions to Jev", async () => {
    const { service, jevDecide, store } = setup(
      { keepRequests: true, mode: "hybrid", localUrl: "http://127.0.0.1:8000" },
      localYes,
    );
    const result = await service.decide({ ...gate, purpose: "notify" });
    expect(result.provider).toBe("local");
    expect(result.model).toBe("laya-multilingual");
    expect(store.entries[0]).toMatchObject({ provider: "local", model: "laya-multilingual" });
    expect(store.entries[0]!.request).toBeDefined();
    await service.decide(wide);
    expect(jevDecide).toHaveBeenCalledOnce();
    expect(suitsLocal(wide)).toBe(false);
  });

  it("hybrid falls back to Jev when the local server fails", async () => {
    const { service, jevDecide } = setup(
      { keepRequests: true, mode: "hybrid", localUrl: "http://127.0.0.1:8000" },
      async () => {
        throw new Error("connection refused");
      },
    );
    const result = await service.decide({ ...gate, purpose: "notify" });
    expect(jevDecide).toHaveBeenCalledOnce();
    expect(result.provider).not.toBe("local");
  });

  it("local mode needs no Jev at all, and stays conservative when the server is down", async () => {
    const { service, jevDecide } = setup(
      { keepRequests: true, mode: "local", localUrl: "http://127.0.0.1:8000" },
      async () => {
        throw new Error("down");
      },
    );
    const result = await service.decide(wide);
    expect(jevDecide).not.toHaveBeenCalled();
    expect(result).toMatchObject({ provider: "heuristic", model: LOCAL_UNAVAILABLE_MODEL });
  });

  it("an answer missing a question is not trusted", async () => {
    const { service, jevDecide } = setup(
      { keepRequests: true, mode: "hybrid", localUrl: "http://127.0.0.1:8000" },
      async () => ({ response: { model: "x", answers: {} }, latencyMs: 1 }),
    );
    await service.decide({ ...gate, purpose: "notify" });
    expect(jevDecide).toHaveBeenCalledOnce();
  });

  it("puts a local model's confidence on Jev's scale with its own, stricter bands", () => {
    const bands = { autoMin: 0.95, confirmMin: 0.6 };
    expect(onJevConfidence(0.95, bands)).toBeCloseTo(0.9);
    expect(onJevConfidence(0.92, bands)).toBeLessThan(0.9);
    expect(onJevConfidence(0.6, bands)).toBeCloseTo(0.5);
    expect(onJevConfidence(1, bands)).toBe(1);
    const scaled = onJevScale(
      {
        yes: { type: "noul", noul: 0.96 },
        no: { type: "noul", noul: 0.04 },
        pick: { type: "choice", choice: "a", confidence: 0.6, probabilities: { a: 0.8, b: 0.2 } },
      },
      bands,
    );
    // 0.96 is 0.92 sure on the local scale: below its auto line, so below Jev's 0.9 too.
    expect(scaled.yes).toMatchObject({ type: "noul" });
    expect((scaled.yes as { noul: number }).noul).toBeLessThan(0.95);
    expect((scaled.yes as { noul: number }).noul).toBeGreaterThan(0.5);
    expect((scaled.no as { noul: number }).noul).toBeLessThan(0.5);
    expect((scaled.pick as { confidence: number }).confidence).toBeCloseTo(0.5);
  });

  it("sends screenshots to the vision server only, and marks what it read", async () => {
    const shot = { mime: "image/jpeg" as const, data: "AAAA" };
    const withVision = setup(
      { keepRequests: true, mode: "jev", visionUrl: "http://127.0.0.1:8765" },
      localYes,
    );
    const seen = await withVision.service.decide({ ...gate, purpose: "trigger", images: [shot] });
    expect(withVision.calls[0]).toMatchObject({ images: ["data:image/jpeg;base64,AAAA"] });
    expect(seen.sawImages).toBe(true);
    expect(withVision.service.canSeeImages()).toBe(true);
  });

  it("never answers a question about a picture without it (M1)", async () => {
    const shot = { mime: "image/jpeg" as const, data: "AAAA" };
    // No vision server: the safe answers, Jev isn't asked to guess from the text.
    const noVision = setup({ keepRequests: true, mode: "jev" }, localYes);
    const a = await noVision.service.decide({ ...gate, images: [shot] });
    expect(noVision.jevDecide).not.toHaveBeenCalled();
    expect(a).toMatchObject({ provider: "heuristic", model: VISION_UNAVAILABLE_MODEL });
    expect(a.sawImages).not.toBe(true);
    // A vision server that fails: the same.
    const down = setup(
      { keepRequests: true, mode: "jev", visionUrl: "http://127.0.0.1:8765" },
      async () => {
        throw new Error("down");
      },
    );
    const b = await down.service.decide({ ...gate, images: [shot] });
    expect(down.jevDecide).not.toHaveBeenCalled();
    expect(b.model).toBe(VISION_UNAVAILABLE_MODEL);
  });

  it("keeps the risk gate on Jev in hybrid mode (an allow there skips the card)", () => {
    expect(suitsLocal(gate)).toBe(false);
    expect(suitsLocal({ ...gate, purpose: "notify" })).toBe(true);
  });

  it("refuses a local answer of the wrong type, off the options or off the scale", async () => {
    const bad = [
      { external_side_effect: { type: "choice", choice: "x", confidence: 1, probabilities: {} } },
      { external_side_effect: { type: "noul", noul: 5 } },
      { external_side_effect: { type: "noul" } },
    ];
    for (const answers of bad) {
      const { service, jevDecide } = setup(
        { keepRequests: true, mode: "hybrid", localUrl: "http://127.0.0.1:8000" },
        async () => ({ response: { model: "x", answers }, latencyMs: 1 }),
      );
      await service.decide({ ...gate, purpose: "notify" });
      expect(jevDecide, JSON.stringify(answers)).toHaveBeenCalledOnce();
    }
    const choiceQ = { type: "choice" as const, instructions: "?", criteria: { a: "A", b: "B" } };
    expect(
      answerProblem(choiceQ, { type: "choice", choice: "c", confidence: 0.9, probabilities: {} }),
    ).toMatch(/not one of the options/);
    expect(
      answerProblem(choiceQ, { type: "choice", choice: "a", confidence: 0.9, probabilities: {} }),
    ).toBeUndefined();
  });

  it("a coin flip stays a coin flip on Jev's scale", () => {
    const scaled = onJevScale(
      { q: { type: "noul", noul: 0.5 } },
      { autoMin: 0.95, confirmMin: 0.6 },
    );
    expect((scaled.q as { noul: number }).noul).toBe(0.5);
  });
});

describe("vision bands, on answers measured live with ImaJev 4B", () => {
  it("lets the real confirmation and walls through, and nothing ordinary", () => {
    const scaled = onJevScale(
      {
        goal: { type: "choice", choice: "yes", confidence: 0.89, probabilities: {} },
        login: { type: "noul", noul: 0.87 },
        captcha: { type: "noul", noul: 0.85 },
        ordinary: { type: "noul", noul: 0.2 },
      },
      VISION_BANDS,
    );
    expect((scaled.goal as { confidence: number }).confidence).toBeGreaterThanOrEqual(0.9);
    expect((scaled.login as { noul: number }).noul).toBeGreaterThanOrEqual(0.85);
    expect((scaled.captcha as { noul: number }).noul).toBeGreaterThanOrEqual(0.85);
    expect((scaled.ordinary as { noul: number }).noul).toBeLessThan(0.5);
  });
});
