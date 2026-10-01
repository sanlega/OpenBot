import type {
  Transport,
  TransportMode,
  TransportOptions,
  WsCommand,
  WsInbound,
  WsOutbound,
} from "./types.js";
import { LOCAL_KEY_HEADER } from "./local-key.js";

function joinUrl(base: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/$/, "")}${normalized}`;
}

/** HTTP + WebSocket client for the Client API (plan §4.7). */
export class HttpTransport implements Transport {
  readonly mode: TransportMode;
  readonly baseUrl: string;
  private readonly deviceToken?: string;
  private readonly localKeySource?: string | (() => string | undefined);
  private knownLocalKey?: string;
  /** Aborted by close(): a closed transport's requests never settle (nothing is left to answer). */
  private readonly lifetime = new AbortController();

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.mode = options.mode ?? "local";
    this.deviceToken = options.deviceToken;
    this.localKeySource = options.localKey;
  }

  /** Read on every request: the desktop app's key can appear after the page loaded. */
  private localKey(): string | undefined {
    if (this.knownLocalKey) return this.knownLocalKey;
    const source = this.localKeySource;
    const key = typeof source === "function" ? source() : source;
    // Asked again only until there is one (the desktop app reads a file per ask).
    if (key) this.knownLocalKey = key;
    return key;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.deviceToken) {
      headers.Authorization = `Bearer ${this.deviceToken}`;
    }
    const localKey = this.localKey();
    if (localKey) headers[LOCAL_KEY_HEADER] = localKey;
    return { ...headers, ...extra };
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("GET", path, undefined, init);
  }

  async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("POST", path, body, init);
  }

  async patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PATCH", path, body, init);
  }

  async put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PUT", path, body, init);
  }

  async delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("DELETE", path, undefined, init);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const closed = this.lifetime.signal;
    if (closed.aborted) return new Promise<T>(() => undefined);
    const signal = init?.signal ? AbortSignal.any([init.signal, closed]) : closed;
    let res: Response;
    try {
      res = await fetch(joinUrl(this.baseUrl, path), {
        ...init,
        signal,
        method,
        headers: this.headers({
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (closed.aborted) return new Promise<T>(() => undefined);
      throw error;
    }
    if (!res.ok) {
      // A refused key (replaced, or a newer #key= link pasted): ask for it again next time.
      if (res.status === 401) this.knownLocalKey = undefined;
      const error = new Error(`${method} ${path} failed: ${res.status}`) as Error & {
        status?: number;
        body?: unknown;
      };
      error.status = res.status;
      // The server's `{ error, reason }` lets screens show why, not just that it failed.
      error.body = await res.json().catch(() => undefined);
      throw error;
    }
    return (await res.json()) as T;
  }

  connectWebSocket(
    onMessage: (msg: WsInbound) => void,
    onClose?: () => void,
    onOpen?: () => void,
  ): { subscribe(since: number): void; send(command: WsCommand): void; close(): void } {
    // A browser can't set headers on a WebSocket: the key rides in the address (loopback only).
    const wsUrl =
      joinUrl(this.baseUrl, "/api/ws").replace(/^http/, "ws") +
      (this.localKey() ? `?key=${encodeURIComponent(this.localKey()!)}` : "");
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (ev) => {
      onMessage(JSON.parse(String(ev.data)) as WsInbound);
    });
    ws.addEventListener("close", () => onClose?.());

    // Frames sent before the socket opens are queued, not dropped.
    const pending: string[] = [];
    const sendFrame = (frame: WsOutbound) => {
      const text = JSON.stringify(frame);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else pending.push(text);
    };
    ws.addEventListener("open", () => {
      for (const text of pending.splice(0)) ws.send(text);
      onOpen?.();
    });

    return {
      subscribe(since: number) {
        sendFrame({ type: "subscribe", since });
      },
      send(command: WsCommand) {
        sendFrame({ type: "command", ...command });
      },
      close() {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      },
    };
  }

  async close(): Promise<void> {
    this.lifetime.abort();
  }
}

export function createTransport(options: TransportOptions): Transport {
  return new HttpTransport(options);
}
