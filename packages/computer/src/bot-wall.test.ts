import { describe, expect, it } from "vitest";
import type { Observation } from "@openbot/contracts";
import { detectBotWall } from "./bot-wall.js";
import { classifyBlocker } from "./fast-loop.js";

const page = (over: Partial<Observation>): Observation => ({
  url: "https://shop.example/",
  title: "Shop",
  elements: [],
  ...over,
});

describe("detectBotWall (B7)", () => {
  it("names the wall and whether it clears alone", () => {
    expect(detectBotWall(page({ title: "Just a moment..." }))).toMatchObject({
      family: "cloudflare",
      host: "shop.example",
      clearsAlone: true,
    });
    const turnstile = detectBotWall(
      page({
        elements: [
          {
            index: 0,
            role: "iframe",
            label: "Widget containing a Cloudflare security challenge cf-turnstile",
          },
        ],
      }),
    );
    expect(turnstile).toMatchObject({ family: "turnstile", clearsAlone: false });
    expect(turnstile?.reason).toMatch(/Cloudflare Turnstile blocked the page on shop\.example/);
    expect(detectBotWall(page({ text: "Please verify: px-captcha Press & Hold" }))?.family).toBe(
      "perimeterx",
    );
    expect(
      detectBotWall(page({ title: "Access Denied", text: "Access Denied ... Reference #18.1234" }))
        ?.family,
    ).toBe("akamai");
  });

  it("leaves ordinary pages alone", () => {
    expect(detectBotWall(page({ text: "Welcome to our shop" }))).toBeUndefined();
  });

  it("a wall a person must solve is a CAPTCHA blocker; a passing check is not", () => {
    expect(classifyBlocker(page({ text: "hcaptcha challenge" }))).toBe("captcha");
    expect(classifyBlocker(page({ title: "Just a moment..." }))).toBe("other");
  });
});
