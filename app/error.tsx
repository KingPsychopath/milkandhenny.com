"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SITE_BRAND } from "@/lib/config";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-md space-y-8">
        {/* Brand */}
        <Link
          href="/"
          className="font-mono text-sm font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
        >
          {SITE_BRAND}
        </Link>

        {/* Error */}
        <div className="space-y-3">
          <h1 className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            oops
          </h1>
          <p className="font-serif text-xl text-foreground">
            something broke
          </p>
          <p className="theme-muted text-sm">
            it happens to the best of us. try again, or head home.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
          >
            ↻ try again
          </button>
          <span className="hidden sm:inline theme-faint">·</span>
          <Link
            href="/"
            className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
          >
            ← go home
          </Link>
        </div>

        {error.digest && (
          <p className="font-mono text-[10px] theme-faint">
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
