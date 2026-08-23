import { Link } from "@tanstack/react-router";

import type { PitchOperationalStatus } from "../types";

export function PitchOperationalNotice({ status }: { status: PitchOperationalStatus }) {
  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-6 py-20">
      <Link to="/things" className="font-mono text-xs theme-muted hover:opacity-60">
        ← things
      </Link>
      <p className="mt-16 font-mono text-micro uppercase tracking-[0.18em] text-[var(--things-amber)]">
        pitch night studio
      </p>
      <h1 className="mt-3 font-serif text-5xl text-foreground">The studio is taking a break.</h1>
      <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed theme-muted">
        {status.message} Existing local work stays in the browser that created it.
      </p>
      <p className="mt-8 font-mono text-xs theme-muted">Please try again later.</p>
    </main>
  );
}
