import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransport } from "./http-transport.js";
import { LOCAL_KEY_HEADER } from "./local-key.js";

afterEach(() => vi.unstubAllGlobals());

describe("the owner key on the app's requests (D-036)", () => {
  it("sends it, keeps it, and asks again after it is refused", async () => {
    const seen: Array<string | undefined> = [];
    let refuse = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push((init.headers as Record<string, string>)[LOCAL_KEY_HEADER]);
        const ok = !refuse;
        refuse = false;
        return new Response(JSON.stringify(ok ? { ok: true } : { error: "unauthorized" }), {
          status: ok ? 200 : 401,
        });
      }),
    );
    let current = "old";
    const source = vi.fn(() => current);
    const transport = createTransport({ baseUrl: "http://127.0.0.1:4577", localKey: source });

    await expect(transport.get("/api/setup")).rejects.toMatchObject({ status: 401 });
    current = "new";
    await transport.get("/api/setup");
    await transport.get("/api/setup");
    expect(seen).toEqual(["old", "new", "new"]);
    // Once accepted, it isn't looked up again for every request.
    expect(source).toHaveBeenCalledTimes(2);
  });
});
