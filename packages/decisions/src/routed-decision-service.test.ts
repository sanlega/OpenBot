import { describe, expect, it, vi } from "vitest";
import type { DecideRequest, DecisionService, DecisionSettings } from "@openbot/contracts";
import { DecisionLog, InMemoryDecisionLog } from "./decision-log.js";
import { FakeDecisionService } from "./fake-decision-service.js";
import {
  LOCAL_UNAVAILABLE_MODEL,
  onJevConfidence,
  onJevScale,
  RoutedDecisionService,
  suitsLocal,
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
    const result = await service.decide(gate);
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
    const result = await service.decide(gate);
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
    await service.decide(gate);
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

  it("sends screenshots to the vision server only, and decides without them otherwise", async () => {
    const shot = { mime: "image/jpeg" as const, data: "AAAA" };
    const withVision = setup(
      { keepRequests: true, mode: "jev", visionUrl: "http://127.0.0.1:8765" },
      localYes,
    );
    await withVision.service.decide({ ...gate, images: [shot] });
    expect(withVision.calls[0]).toMatchObject({ images: ["data:image/jpeg;base64,AAAA"] });
    expect(withVision.service.canSeeImages()).toBe(true);

    const noVision = setup({ keepRequests: true, mode: "jev" }, localYes);
    await noVision.service.decide({ ...gate, images: [shot] });
    expect(noVision.calls).toHaveLength(0);
    expect(noVision.jevDecide.mock.calls[0]![0]).not.toHaveProperty("images");
    expect(noVision.service.canSeeImages()).toBe(false);
  });
});
