import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { refuseCdpCommand, urlAllowed } from "./cdp-policy.js";
import { CdpProxy } from "./cdp-proxy.js";

describe("CDP policy (B5)", () => {
  const any = { allowHosts: ["*"], mode: "act" as const };
  const shop = { allowHosts: ["shop.example"], mode: "read" as const };

  it("never hands out sign-ins, storage, interception or the browser itself", () => {
    for (const method of [
      "Network.getAllCookies",
      "Network.getCookies",
      "Storage.getCookies",
      "IndexedDB.requestData",
      "Fetch.enable",
      "Browser.close",
    ]) {
      expect(refuseCdpCommand({ id: 1, method }, any), method).toBeDefined();
    }
    expect(
      refuseCdpCommand({ id: 1, method: "Page.navigate", params: { url: "https://x.test" } }, any),
    ).toBeUndefined();
    expect(refuseCdpCommand({ id: 1, method: "Runtime.evaluate" }, any)).toBeUndefined();
  });

  it("keeps a tool on its sites and out of chrome:// and file://", () => {
    expect(urlAllowed("https://www.shop.example/cart", shop)).toBe(true);
    expect(urlAllowed("https://evil.test/", shop)).toBe(false);
    expect(urlAllowed("chrome://settings", any)).toBe(false);
    expect(urlAllowed("file:///etc/passwd", any)).toBe(false);
    expect(
      refuseCdpCommand(
        { id: 1, method: "Target.createTarget", params: { url: "https://evil.test" } },
        shop,
      ),
    ).toMatch(/not allowed/);
    // A page that wandered off can only be closed or let go.
    expect(
      refuseCdpCommand(
        { id: 2, method: "Runtime.evaluate", sessionId: "s1" },
        shop,
        "https://evil.test/",
      ),
    ).toMatch(/outside the sites/);
    expect(
      refuseCdpCommand(
        { id: 3, method: "Target.closeTarget", sessionId: "s1" },
        shop,
        "https://evil.test/",
      ),
    ).toBeUndefined();
  });

  it("a read grant cannot click or type, also through nested messages", () => {
    expect(refuseCdpCommand({ id: 1, method: "Input.dispatchMouseEvent" }, shop)).toMatch(
      /only read/,
    );
    expect(
      refuseCdpCommand(
        {
          id: 2,
          method: "Target.sendMessageToTarget",
          params: { message: JSON.stringify({ id: 9, method: "Network.getAllCookies" }) },
        },
        any,
      ),
    ).toBeDefined();
  });
});

describe("CdpProxy (B5)", () => {
  let browser: Server | undefined;
  let front: Server | undefined;
  afterEach(() => {
    browser?.close();
    front?.close();
  });

  /** A fake Chromium: DevTools discovery plus a socket that echoes what it receives. */
  async function fakeBrowser() {
    const received: string[] = [];
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const port = (server.address() as AddressInfo).port;
      if (req.url?.startsWith("/json/version")) {
        res.end(
          JSON.stringify({
            Browser: "Chromium/130",
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc`,
          }),
        );
      } else {
        res.end(
          JSON.stringify([
            {
              id: "p1",
              type: "page",
              url: "https://shop.example/",
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/p1`,
            },
            {
              id: "p2",
              type: "page",
              url: "https://other.test/",
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/p2`,
            },
            { id: "ui", type: "browser_ui", url: "chrome://omnibox/" },
          ]),
        );
      }
    });
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) =>
      socket.on("message", (data) => {
        received.push(data.toString());
        const msg = JSON.parse(data.toString()) as { id: number; method?: string };
        socket.send(
          JSON.stringify({
            id: msg.id,
            result: msg.method === "Target.createTarget" ? { targetId: "T9" } : { ok: true },
          }),
        );
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    browser = server;
    return { port: (server.address() as AddressInfo).port, received };
  }

  async function proxyFor(port: number | undefined, onTabs?: (bot: string, ids: string[]) => void) {
    const proxy = new CdpProxy({ debugPortFor: async () => port, onTabs });
    const server = createServer((req, res) => {
      void proxy.handleHttp(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(401);
          res.end();
        }
      });
    });
    server.on("upgrade", (req, socket, head) => {
      if (!proxy.handleUpgrade(req, socket, head)) socket.destroy();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    front = server;
    return { proxy, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  it("rewrites discovery to itself and filters the commands on the socket", async () => {
    const chrome = await fakeBrowser();
    const { proxy, base } = await proxyFor(chrome.port);
    const grant = proxy.grant("bot_a", { allowHosts: ["shop.example"], mode: "act" });
    const version = (await (await fetch(`${base}/cdp/${grant.token}/json/version/`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    expect(version.webSocketDebuggerUrl).toBe(
      `${base.replace("http", "ws")}/cdp/${grant.token}/devtools/browser/abc`,
    );
    const list = (await (await fetch(`${base}/cdp/${grant.token}/json/list`)).json()) as Array<{
      id: string;
    }>;
    expect(list.map((t) => t.id)).toEqual(["p1"]);

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const replies: Array<{ id: number; error?: { message: string }; result?: unknown }> = [];
    ws.on("message", (d) => replies.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    ws.send(
      JSON.stringify({ id: 2, method: "Page.navigate", params: { url: "https://shop.example/a" } }),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(replies.find((r) => r.id === 1)?.error?.message).toMatch(
      /OpenBot: Network.getAllCookies/,
    );
    expect(replies.find((r) => r.id === 2)?.result).toEqual({ ok: true });
    expect(chrome.received.map((m) => JSON.parse(m).method)).toEqual(["Page.navigate"]);

    // Revoked (the user took over): the socket closes and the URL stops working.
    const closed = new Promise((r) => ws.once("close", r));
    proxy.revoke("bot_a");
    await closed;
    expect((await fetch(`${base}/cdp/${grant.token}/json/version`)).status).toBe(404);
  });

  it("reports the tabs a connector opens, so OpenBot leaves them alone (N1)", async () => {
    const chrome = await fakeBrowser();
    const seen: string[][] = [];
    const { proxy, base } = await proxyFor(chrome.port, (_bot, ids) => seen.push(ids));
    const grant = proxy.grant("bot_a", { allowHosts: ["*"], mode: "act" });
    const ws = new WebSocket(
      `${base.replace("http", "ws")}/cdp/${grant.token}/devtools/browser/abc`,
    );
    await new Promise((r) => ws.once("open", r));
    ws.send(
      JSON.stringify({ id: 7, method: "Target.createTarget", params: { url: "about:blank" } }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(seen.at(-1)).toEqual(["T9"]);
    proxy.revoke("bot_a");
    expect(seen.at(-1)).toEqual([]);
  });

  it("refuses unknown tokens and bots without a screen", async () => {
    const { proxy, base } = await proxyFor(undefined);
    expect((await fetch(`${base}/cdp/${"0".repeat(48)}/json/version`)).status).toBe(404);
    const grant = proxy.grant("bot_b", { allowHosts: ["*"], mode: "act" });
    expect((await fetch(`${base}/cdp/${grant.token}/json/version`)).status).toBe(409);
    // Anything else on the daemon still needs its bearer token.
    expect((await fetch(`${base}/health`)).status).toBe(401);
  });
});
