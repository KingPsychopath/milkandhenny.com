import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import {
  forgetScanner,
  readRememberedScanners,
  type RememberedScanner,
} from "@/features/tickets/scanner-memory";

/**
 * Scanner home for a helper's phone.
 *
 * Lists every scanner link this device has opened recently so a lost tab is
 * a one-tap recovery. Purely client-side: the tokens live in the device's
 * own storage and the server learns nothing until one is opened.
 */
export const Route = createFileRoute("/scan/")({
  component: ScanIndexRoute,
  head: () => ({
    meta: [{ title: `Scanner — ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function ScanIndexRoute() {
  const [scanners, setScanners] = useState<RememberedScanner[] | null>(null);

  useEffect(() => {
    setScanners(readRememberedScanners());
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <main id="main" className="mx-auto max-w-md px-6 pt-16 pb-16">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">scanner</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">Your scanners</h1>

        {scanners === null ? null : scanners.length === 0 ? (
          <p className="mt-6 font-mono text-sm theme-muted leading-relaxed">
            Nothing remembered on this phone yet. Open the scanner link the organiser sent you —
            after that, this page can always take you back to it.
          </p>
        ) : (
          <ul className="mt-6 divide-y theme-border border-y theme-border">
            {scanners.map((scanner) => (
              <li key={scanner.token} className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">{scanner.eventTitle}</p>
                  <p className="truncate font-mono text-micro theme-muted">
                    {scanner.station} · {scanner.label}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to="/scan/$token"
                    params={{ token: scanner.token }}
                    className="min-h-10 rounded-lg bg-foreground px-4 py-2.5 font-mono text-micro text-background"
                  >
                    open
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      forgetScanner(scanner.token);
                      setScanners(readRememberedScanners());
                    }}
                    className="min-h-10 px-2 font-mono text-micro theme-muted hover:text-foreground transition-colors"
                  >
                    forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
