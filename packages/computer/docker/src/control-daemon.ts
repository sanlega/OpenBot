import type {
  Action,
  ActResult,
  BoxDiagnostics,
  ExecResult,
  Observation,
} from "@openbot/contracts";

/** HTTP control daemon inside `images/desktop` (plan WS9). */
export interface ControlDaemonClient {
  observe(botId: string, display: number): Promise<Observation>;
  act(botId: string, display: number, action: Action): Promise<ActResult>;
  liveView(botId: string): Promise<{ url: string; token: string; expiresAt: string }>;
  health(): Promise<{ ok: boolean; protocol?: number }>;
  /** Runs a shell command inside the machine (missing on old daemons). */
  exec?(request: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    stdin?: string;
  }): Promise<ExecResult>;
  /** The machine's self-checks (missing on old daemons). */
  diagnose?(): Promise<BoxDiagnostics>;
  /** Takes a bot's screen lease away (the user took over its screen). */
  revoke?(botId: string): Promise<void>;
}

export interface ControlDaemonOptions {
  baseUrl: string;
  token?: string;
}

/** fetch's "fetch failed" hides the reason; surface ECONNREFUSED, timeouts, etc. */
async function call(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const reason =
      (error as Error).name === "TimeoutError"
        ? "timed out"
        : (cause?.code ?? cause?.message ?? (error as Error).message);
    throw new Error(`computer ${what} failed: ${reason}`, { cause: error });
  }
}

/** The daemon's own reason for a failed request (`{ ok: false, reason }`), when it gave one. */
async function failure(what: string, res: Response): Promise<Error> {
  let reason = "";
  try {
    reason = String(((await res.json()) as { reason?: unknown }).reason ?? "");
  } catch {
    // No body.
  }
  return new Error(
    reason ? `computer ${what} failed: ${reason}` : `control daemon ${what} failed: ${res.status}`,
  );
}

export class HttpControlDaemonClient implements ControlDaemonClient {
  /** Each bot's screen lease (B4): `/act` and `/observe` refuse a bot's screen without it. */
  private readonly leases = new Map<string, string>();

  constructor(private readonly options: ControlDaemonOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    return headers;
  }

  private async lease(botId: string, fresh = false): Promise<string> {
    const known = this.leases.get(botId);
    if (known && !fresh) return known;
    const res = await call("lease", () =>
      fetch(`${this.options.baseUrl}/screens/lease`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ botId }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (res.status === 404) return ""; // an older daemon without leases
    if (!res.ok) throw await failure("lease", res);
    const lease = String(((await res.json()) as { lease?: unknown }).lease ?? "");
    this.leases.set(botId, lease);
    return lease;
  }

  /** Sends a screen request with the bot's lease, renewing it once if the daemon lost it. */
  private async withLease(
    botId: string,
    send: (headers: Record<string, string>) => Promise<Response>,
  ): Promise<Response> {
    const attempt = async (fresh: boolean) => {
      const lease = await this.lease(botId, fresh);
      return send({ ...this.headers(), ...(lease ? { "x-openbot-screen": lease } : {}) });
    };
    const res = await attempt(false);
    // A restarted daemon, or a screen given to another bot meanwhile: get a new lease once.
    return res.status === 403 ? attempt(true) : res;
  }

  async health(): Promise<{ ok: boolean; protocol?: number }> {
    const res = await fetch(`${this.options.baseUrl}/health`, { headers: this.headers() });
    if (!res.ok) return { ok: false };
    try {
      const body = (await res.json()) as { protocol?: unknown };
      return {
        ok: true,
        ...(typeof body.protocol === "number" ? { protocol: body.protocol } : {}),
      };
    } catch {
      return { ok: true };
    }
  }

  async observe(botId: string, display: number): Promise<Observation> {
    const url = new URL(`${this.options.baseUrl}/observe`);
    url.searchParams.set("botId", botId);
    url.searchParams.set("display", String(display));
    const res = await call("observe", () =>
      this.withLease(botId, (headers) =>
        fetch(url, { headers, signal: AbortSignal.timeout(20_000) }),
      ),
    );
    if (!res.ok) throw await failure("observe", res);
    return (await res.json()) as Observation;
  }

  async act(botId: string, display: number, action: Action): Promise<ActResult> {
    const res = await call("action", () =>
      this.withLease(botId, (headers) =>
        fetch(`${this.options.baseUrl}/act`, {
          method: "POST",
          headers,
          body: JSON.stringify({ botId, display, action }),
          signal: AbortSignal.timeout(45_000),
        }),
      ),
    );
    if (!res.ok) throw await failure("action", res);
    return (await res.json()) as ActResult;
  }

  async revoke(botId: string): Promise<void> {
    this.leases.delete(botId);
    await fetch(`${this.options.baseUrl}/screens/revoke`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ botId }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  async exec(request: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    stdin?: string;
  }): Promise<ExecResult> {
    const res = await call("command", () =>
      fetch(`${this.options.baseUrl}/exec`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
        // The daemon enforces the command's own limit; this only covers a daemon that hangs.
        signal: AbortSignal.timeout((request.timeoutMs ?? 120_000) + 15_000),
      }),
    );
    if (res.status === 404) {
      throw new Error(
        "this desktop image is too old to run commands; update it in Settings > Computer",
      );
    }
    if (!res.ok) throw new Error(`control daemon exec failed: ${res.status}`);
    return (await res.json()) as ExecResult;
  }

  async diagnose(): Promise<BoxDiagnostics> {
    const res = await call("self-check", () =>
      fetch(`${this.options.baseUrl}/doctor`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(60_000),
      }),
    );
    if (res.status === 404) {
      return {
        ok: false,
        checks: [
          {
            name: "image",
            ok: false,
            detail:
              "this desktop image is too old for self-checks; update it in Settings > Computer",
          },
        ],
        screens: [],
        telemetry: [],
      };
    }
    if (!res.ok) throw await failure("self-check", res);
    return (await res.json()) as BoxDiagnostics;
  }

  async liveView(botId: string): Promise<{ url: string; token: string; expiresAt: string }> {
    const url = new URL(`${this.options.baseUrl}/live`);
    url.searchParams.set("botId", botId);
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`control daemon live failed: ${res.status}`);
    return (await res.json()) as { url: string; token: string; expiresAt: string };
  }
}
