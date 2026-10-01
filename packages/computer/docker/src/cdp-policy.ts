/**
 * B5: what a third-party tool (a browser-automation MCP connector) may ask a bot's VM browser
 * over DevTools. Without a filter, the DevTools port hands out every cookie of every site; with
 * it, a connector can browse and act on pages but never dump sessions, read storage, intercept
 * traffic, or close the browser. Grok Bot puts the same kind of proxy in front of the tools it
 * lets drive its Chrome.
 */
export interface CdpGrantPolicy {
  /** Sites the tool may open: host names (subdomains included), or `*` for any http(s) site. */
  allowHosts: string[];
  /** `read` cannot send mouse or keyboard input; `act` can. */
  mode: "read" | "act";
}

/** Never, whatever the grant: these read or change every site's sign-ins, or the browser itself. */
const DENIED_METHODS = new Set([
  "Network.getAllCookies",
  "Network.getCookies",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Network.deleteCookies",
  "Network.setCookies",
  "Network.loadNetworkResource",
  "Browser.close",
  "Browser.crash",
  "Browser.crashGpuProcess",
  "Browser.executeBrowserCommand",
  "Browser.grantPermissions",
  "Browser.setPermission",
  "Target.exposeDevToolsProtocol",
  "Target.setRemoteLocations",
]);

/** Whole domains no tool gets: storage, interception, profiling, the system. */
const DENIED_DOMAINS = new Set([
  "Storage",
  "IndexedDB",
  "CacheStorage",
  "DOMStorage",
  "Fetch",
  "ServiceWorker",
  "SystemInfo",
  "Tracing",
  "HeapProfiler",
  "Memory",
  "Cast",
  "WebAuthn",
  "BackgroundService",
  "Extensions",
  "FedCm",
  "Autofill",
]);

/** Whether a URL may be opened under the grant. */
export function urlAllowed(url: string | undefined, policy: CdpGrantPolicy): boolean {
  if (!url || url === "about:blank") return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Never chrome://, file://, javascript:, data: or a DevTools page.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (policy.allowHosts.includes("*")) return true;
  const host = parsed.hostname.toLowerCase();
  return policy.allowHosts.some((allowed) => {
    const a = allowed.toLowerCase().replace(/^\*\./, "");
    return host === a || host.endsWith(`.${a}`);
  });
}

/** A command as it travels over the DevTools socket. */
export interface CdpCommand {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Why a command is refused under the grant, or undefined when it may go to the browser.
 * `targetUrl` is the page the command's session is on, when the proxy knows it.
 */
export function refuseCdpCommand(
  command: CdpCommand,
  policy: CdpGrantPolicy,
  targetUrl?: string,
): string | undefined {
  const method = command.method ?? "";
  const domain = method.split(".")[0] ?? "";
  if (DENIED_METHODS.has(method) || DENIED_DOMAINS.has(domain)) {
    return `${method} is not available to connectors in OpenBot's virtual machine`;
  }
  if (policy.mode === "read" && domain === "Input") {
    return "this connector may only read pages, not click or type";
  }
  const params = command.params ?? {};
  if (method === "Page.navigate" || method === "Target.createTarget") {
    const url = typeof params.url === "string" ? params.url : undefined;
    if (!urlAllowed(url, policy))
      return `opening ${url ?? "that page"} is not allowed for this connector`;
    return undefined;
  }
  if (method === "Network.setCookie") {
    const url = typeof params.url === "string" ? params.url : undefined;
    const domainParam = typeof params.domain === "string" ? params.domain : undefined;
    const target = url ?? (domainParam ? `https://${domainParam.replace(/^\./, "")}/` : undefined);
    if (!target || !urlAllowed(target, policy))
      return "setting cookies for that site is not allowed";
    return undefined;
  }
  if (method === "Target.sendMessageToTarget" && typeof params.message === "string") {
    try {
      return refuseCdpCommand(JSON.parse(params.message) as CdpCommand, policy, targetUrl);
    } catch {
      return "unreadable nested DevTools message";
    }
  }
  // A page that left the allowed sites can only be sent back, closed or let go.
  if (command.sessionId && targetUrl && !urlAllowed(targetUrl, policy)) {
    const leaving = new Set([
      "Target.detachFromTarget",
      "Target.closeTarget",
      "Page.close",
      "Runtime.runIfWaitingForDebugger",
    ]);
    if (!leaving.has(method)) return `that page (${targetUrl}) is outside the sites allowed`;
  }
  return undefined;
}
