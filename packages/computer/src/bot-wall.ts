import type { Observation } from "@openbot/contracts";

/** The anti-bot systems a page can put in front of a bot (B7). */
export type BotWallFamily =
  "cloudflare" | "turnstile" | "hcaptcha" | "recaptcha" | "datadome" | "perimeterx" | "akamai";

export interface BotWall {
  family: BotWallFamily;
  host?: string;
  /** Whether it usually clears by itself after a few seconds (a JavaScript check, no widget). */
  clearsAlone: boolean;
  /** What to tell the engine instead of "I couldn't find the button". */
  reason: string;
}

const LABEL: Record<BotWallFamily, string> = {
  cloudflare: "Cloudflare",
  turnstile: "Cloudflare Turnstile",
  hcaptcha: "hCaptcha",
  recaptcha: "reCAPTCHA",
  datadome: "DataDome",
  perimeterx: "HUMAN (PerimeterX)",
  akamai: "Akamai",
};

/** Ordered: the specific widget before the generic page it sits on. */
const SIGNS: Array<{ family: BotWallFamily; clearsAlone: boolean; re: RegExp }> = [
  {
    family: "turnstile",
    clearsAlone: false,
    re: /challenges\.cloudflare\.com\/turnstile|cf-turnstile/i,
  },
  { family: "hcaptcha", clearsAlone: false, re: /hcaptcha\.com|\bh-captcha\b|hcaptcha/i },
  {
    family: "recaptcha",
    clearsAlone: false,
    re: /google\.com\/recaptcha|\bg-recaptcha\b|recaptcha/i,
  },
  { family: "datadome", clearsAlone: false, re: /captcha-delivery\.com|datadome/i },
  { family: "perimeterx", clearsAlone: false, re: /px-captcha|perimeterx|press (&|and) hold/i },
  {
    family: "cloudflare",
    clearsAlone: true,
    re: /just a moment\.\.\.|checking (if the site connection is secure|your browser)|cdn-cgi\/challenge-platform|cf-chl|attention required! \| cloudflare|verify you are human by completing/i,
  },
  {
    family: "akamai",
    clearsAlone: false,
    re: /access denied[\s\S]{0,200}reference #\d|errors\.edgesuite\.net/i,
  },
];

/** Recognises an anti-bot wall by the page's title, URL, text and controls. */
export function detectBotWall(observation: Observation): BotWall | undefined {
  const haystack = [
    observation.title ?? "",
    observation.url ?? "",
    (observation.text ?? "").slice(0, 4_000),
    observation.elements
      .slice(0, 60)
      .map((el) => `${el.role} ${el.label}`)
      .join(" | "),
  ].join("\n");
  const sign = SIGNS.find((s) => s.re.test(haystack));
  if (!sign) return undefined;
  let host: string | undefined;
  try {
    host = observation.url ? new URL(observation.url).hostname : undefined;
  } catch {
    host = undefined;
  }
  const label = LABEL[sign.family];
  return {
    family: sign.family,
    ...(host ? { host } : {}),
    clearsAlone: sign.clearsAlone,
    reason: sign.clearsAlone
      ? `${label} is checking the browser on ${host ?? "this site"}; it usually clears by itself in a few seconds (wait, then read the page again). If it stays, the site is blocking automated browsers.`
      : `${label} blocked the page on ${host ?? "this site"}: a person has to solve it on the Computer tab, or the job has to go another way (another site, an API, a saved export).`,
  };
}
