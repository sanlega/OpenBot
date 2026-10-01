import { useEffect, useState } from "react";
import { OpenBotProvider, useLocalTransport } from "../state/context.js";
import type { Transport } from "../transport/index.js";
import { AppShell } from "../components/layout/AppShell.js";
import { SetupWizard } from "../components/setup/SetupWizard.js";
import { DesignGallery } from "../design/DesignGallery.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { markDesktopPlatform } from "../state/desktop.js";
import { applyStoredTheme } from "../state/theme.js";

// Before the first paint, so a forced light/dark theme never flashes the other.
applyStoredTheme();
markDesktopPlatform();

export interface OpenBotAppProps {
  transport: Transport;
}

export function OpenBotApp({ transport }: OpenBotAppProps) {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  // "offline": nothing answers; "unpaired": the harness answers but doesn't know this device.
  const [unreachable, setUnreachable] = useState<false | "offline" | "unpaired">(false);
  const [attempt, setAttempt] = useState(0);

  // The harness may still be starting (desktop) or be offline (phone): keep trying.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    transport
      .get<{ setup: { completedAt?: string } }>("/api/setup")
      .then((res) => {
        if (cancelled) return;
        setUnreachable(false);
        setSetupComplete(Boolean(res.setup.completedAt));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | undefined)?.status;
        const unpaired = status === 401 || status === 403;
        setUnreachable(unpaired ? "unpaired" : "offline");
        // Pairing takes a while (the owner has to show the code): check back less often.
        retry = setTimeout(() => setAttempt((a) => a + 1), unpaired ? 5000 : 2000);
      });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [transport, attempt]);

  if (setupComplete === null) {
    return (
      <div className="app-status" data-testid="app-connecting">
        <span className="app-status-mark" aria-hidden />
        {unreachable === "unpaired" ? (
          <>
            <h1>This device isn't paired</h1>
            <p>
              OpenBot is running, but only paired devices can use it from another computer or phone.
              On the computer running OpenBot, open Devices, choose Pair a phone and scan the code
              with your phone.
            </p>
          </>
        ) : unreachable ? (
          <>
            <h1>Can't reach OpenBot</h1>
            <p>Make sure the OpenBot app or server is running. Retrying…</p>
          </>
        ) : (
          <p>Connecting…</p>
        )}
      </div>
    );
  }

  // Development aid: the design-system gallery (docs/design-system.md).
  const showDesign =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("design");

  return (
    <ErrorBoundary>
      <OpenBotProvider transport={transport}>
        {showDesign ? (
          <DesignGallery />
        ) : setupComplete ? (
          <AppShell />
        ) : (
          <SetupWizard transport={transport} onComplete={() => setSetupComplete(true)} />
        )}
      </OpenBotProvider>
    </ErrorBoundary>
  );
}

export interface DevAppProps {
  apiBaseUrl?: string;
}

/** Dev/demo entry — point at mock server or real harness. */
export function DevApp({ apiBaseUrl = "http://127.0.0.1:3847" }: DevAppProps) {
  const transport = useLocalTransport(apiBaseUrl);
  return <OpenBotApp transport={transport} />;
}
