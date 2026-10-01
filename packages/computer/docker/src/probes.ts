import { createConnection } from "node:net";

/**
 * A VNC server that listens is not necessarily one that serves a picture: a real RFB greeting
 * ("RFB 003.008\n") is what the live view needs. Resolves false on anything else.
 */
export function rfbGreets(port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let data = "";
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString("latin1");
      if (data.length >= 12) done(/^RFB \d{3}\.\d{3}\n/.test(data.slice(0, 12)));
    });
    socket.on("error", () => done(false));
    socket.on("end", () => done(false));
  });
}

/** The browser answers on its DevTools port (quickly: a hung browser is as bad as a dead one). */
export async function cdpAnswers(debugPort: number, timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
