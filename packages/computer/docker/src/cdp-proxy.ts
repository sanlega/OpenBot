import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  refuseCdpCommand,
  urlAllowed,
  type CdpCommand,
  type CdpGrantPolicy,
} from "./cdp-policy.js";

/** A connector's access to one bot's VM browser. */
export interface CdpGrant extends CdpGrantPolicy {
  token: string;
  botId: string;
  expires: number;
  /** The DevTools port of the bot's browser when the grant was made (its screen). */
  port?: number;
}

export interface CdpProxyOptions {
  /** The DevTools port of a bot's browser, once its screen is up (undefined when it has none). */
  debugPortFor: (botId: string) => Promise<number | undefined>;
  /** Where the browser's own DevTools answer (tests point it elsewhere). */
  browserHost?: string;
  now?: () => number;
  onRefused?: (event: { botId: string; method: string; reason: string }) => void;
  /** N1: the tabs a bot's connectors opened in the browser on `port`, whenever they change. */
  onTabs?: (botId: string, targetIds: string[], port: number | undefined) => void;
}

/** Grants last a working day; a new grant for the same bot replaces the old one. */
export const CDP_GRANT_MS = 8 * 60 * 60_000;
const PATH_RE = /^\/cdp\/([0-9a-f]{48})(\/.*)?$/;

/**
 * B5: DevTools for third-party tools, filtered. Each grant is a capability URL
 * (`/cdp/<token>`) for one bot's VM browser: discovery (`/json/version`, `/json/list`) is
 * rewritten to point back at the proxy, and every command on the socket is checked against the
 * grant (`refuseCdpCommand`) before it reaches Chromium. A refused command gets a DevTools error
 * back; the browser never sees it.
 */
export class CdpProxy {
  private readonly grants = new Map<string, CdpGrant>();
  private readonly sockets = new Map<string, Set<WebSocket>>();
  /** Tabs each bot's connectors created (N1), and the port of the browser they are in. */
  private readonly tabs = new Map<string, Set<string>>();
  private readonly ports = new Map<string, number>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly now: () => number;

  constructor(private readonly options: CdpProxyOptions) {
    this.now = options.now ?? Date.now;
  }

  grant(botId: string, policy: CdpGrantPolicy, ttlMs = CDP_GRANT_MS, port?: number): CdpGrant {
    // A new grant (every turn composes its tools) replaces the old URL, but the connector's tabs
    // stay protected: only a takeover or the screen going away forgets them (R2).
    this.revokeTokens(botId);
    const grant: CdpGrant = {
      token: randomBytes(24).toString("hex"),
      botId,
      allowHosts: policy.allowHosts.length ? policy.allowHosts : ["*"],
      mode: policy.mode,
      expires: this.now() + ttlMs,
      ...(port !== undefined ? { port } : {}),
    };
    if (port !== undefined) this.ports.set(botId, port);
    this.grants.set(grant.token, grant);
    return grant;
  }

  /** The user took the screen over, or it went to another bot: the tool loses it at once. */
  revoke(botId: string): void {
    if (this.tabs.delete(botId)) this.options.onTabs?.(botId, [], this.ports.get(botId));
    this.ports.delete(botId);
    this.revokeTokens(botId);
  }

  private revokeTokens(botId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.botId !== botId) continue;
      this.grants.delete(token);
      for (const socket of this.sockets.get(token) ?? []) socket.close(1008, "access revoked");
      this.sockets.delete(token);
    }
  }

  /** True when the request was a proxy request (answered here). */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const match = PATH_RE.exec((req.url ?? "").split("?")[0] ?? "");
    if (!match) return false;
    const grant = this.find(match[1]!);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!grant) {
      json(404, { error: "unknown or expired DevTools grant" });
      return true;
    }
    const rest = (match[2] ?? "/").replace(/\/+$/, "") || "/";
    const port = await this.options.debugPortFor(grant.botId);
    if (port === undefined) {
      json(409, { error: "this bot has no screen in the virtual machine right now" });
      return true;
    }
    const base = `http://${this.options.browserHost ?? "127.0.0.1"}:${port}`;
    const self = `${req.headers.host ?? "127.0.0.1"}/cdp/${grant.token}`;
    const rewrite = (wsUrl: unknown) =>
      typeof wsUrl === "string" ? wsUrl.replace(/^ws:\/\/[^/]+/, `ws://${self}`) : wsUrl;
    try {
      if (rest === "/json/version") {
        const version = (await (await fetch(`${base}/json/version`)).json()) as Record<
          string,
          unknown
        >;
        json(200, { ...version, webSocketDebuggerUrl: rewrite(version.webSocketDebuggerUrl) });
        return true;
      }
      if (rest === "/json" || rest === "/json/list") {
        const targets = (await (await fetch(`${base}/json/list`)).json()) as Array<
          Record<string, unknown>
        >;
        json(
          200,
          targets
            .filter((t) => t.type === "page" && urlAllowed(String(t.url ?? ""), grant))
            .map((t) => ({
              ...t,
              webSocketDebuggerUrl: rewrite(t.webSocketDebuggerUrl),
              devtoolsFrontendUrl: undefined,
            })),
        );
        return true;
      }
    } catch (error) {
      json(502, { error: `the browser did not answer: ${String(error)}` });
      return true;
    }
    json(404, { error: "not available through the proxy" });
    return true;
  }

  /** True when the upgrade was a proxy socket (handled here). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const match = PATH_RE.exec((req.url ?? "").split("?")[0] ?? "");
    if (!match) return false;
    const grant = this.find(match[1]!);
    const rest = match[2] ?? "";
    if (!grant || !/^\/devtools\/(browser|page)\/[\w-]+$/.test(rest)) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return true;
    }
    void this.options.debugPortFor(grant.botId).then((port) => {
      if (port === undefined) {
        socket.end("HTTP/1.1 409 Conflict\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (client) =>
        this.pipe(client, grant, `ws://${this.options.browserHost ?? "127.0.0.1"}:${port}${rest}`),
      );
    });
    return true;
  }

  private find(token: string): CdpGrant | undefined {
    for (const [known, grant] of this.grants) {
      const a = Buffer.from(known);
      const b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        if (grant.expires <= this.now()) {
          this.grants.delete(known);
          return undefined;
        }
        return grant;
      }
    }
    return undefined;
  }

  private pipe(client: WebSocket, grant: CdpGrant, upstreamUrl: string): void {
    const set = this.sockets.get(grant.token) ?? new Set<WebSocket>();
    set.add(client);
    this.sockets.set(grant.token, set);
    const upstream = new WebSocket(upstreamUrl, { perMessageDeflate: false });
    const queued: RawData[] = [];
    /** Command ids of tab creations, to learn the tab each one made. */
    const creating = new Set<string>();
    const tabsOf = () => {
      const set = this.tabs.get(grant.botId) ?? new Set<string>();
      this.tabs.set(grant.botId, set);
      return set;
    };
    /** Which page each attached session is on, to keep a tool on the sites it may use. */
    const sessionTarget = new Map<string, string>();
    const targetUrl = new Map<string, string>();

    const closeBoth = () => {
      set.delete(client);
      if (client.readyState === WebSocket.OPEN) client.close();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.terminate();
      }
    };

    const fromClient = (data: RawData) => {
      let command: CdpCommand;
      try {
        command = JSON.parse(data.toString()) as CdpCommand;
      } catch {
        return;
      }
      const target = command.sessionId ? sessionTarget.get(command.sessionId) : undefined;
      const reason = refuseCdpCommand(command, grant, target ? targetUrl.get(target) : undefined);
      if (reason) {
        this.options.onRefused?.({ botId: grant.botId, method: command.method ?? "?", reason });
        client.send(
          JSON.stringify({
            id: command.id,
            ...(command.sessionId ? { sessionId: command.sessionId } : {}),
            error: { code: -32000, message: `OpenBot: ${reason}` },
          }),
        );
        return;
      }
      if (command.method === "Target.createTarget" && command.id !== undefined) {
        creating.add(`${command.sessionId ?? ""}:${command.id}`);
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
      else queued.push(data);
    };

    const fromBrowser = (data: RawData) => {
      const text = data.toString();
      try {
        const event = JSON.parse(text) as {
          id?: number;
          sessionId?: string;
          method?: string;
          result?: { targetId?: string };
          params?: {
            sessionId?: string;
            targetId?: string;
            targetInfo?: { targetId?: string; url?: string };
          };
        };
        const key = `${event.sessionId ?? ""}:${event.id ?? ""}`;
        if (event.id !== undefined && creating.delete(key) && event.result?.targetId) {
          tabsOf().add(event.result.targetId);
          this.options.onTabs?.(grant.botId, [...tabsOf()], grant.port);
        }
        if (event.method === "Target.targetDestroyed" && event.params?.targetId) {
          if (tabsOf().delete(event.params.targetId)) {
            this.options.onTabs?.(grant.botId, [...tabsOf()], grant.port);
          }
        }
        const info = event.params?.targetInfo;
        if (info?.targetId && typeof info.url === "string") targetUrl.set(info.targetId, info.url);
        if (
          event.method === "Target.attachedToTarget" &&
          event.params?.sessionId &&
          info?.targetId
        ) {
          sessionTarget.set(event.params.sessionId, info.targetId);
        }
      } catch {
        // Not JSON: pass it on untouched.
      }
      if (client.readyState === WebSocket.OPEN) client.send(text);
    };

    client.on("message", fromClient);
    client.on("close", closeBoth);
    client.on("error", closeBoth);
    upstream.on("open", () => {
      for (const data of queued.splice(0)) upstream.send(data.toString());
    });
    upstream.on("message", fromBrowser);
    upstream.on("close", closeBoth);
    upstream.on("error", closeBoth);
  }
}
