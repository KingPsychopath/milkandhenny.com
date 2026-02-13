"use client";

import { useEffect } from "react";
import Link from "next/link";

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
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center px-6 max-w-md">
        <h1 className="font-mono text-4xl font-bold text-foreground mb-3">
          something broke
        </h1>
        <p className="font-mono text-sm theme-muted mb-8">
          An unexpected error occurred. You can try again, or head back home.
        </p>

        <div className="flex items-center justify-center gap-4 font-mono text-sm">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            try again
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-md theme-border border hover:text-foreground theme-muted transition-colors"
          >
            go home
          </Link>
        </div>

        {error.digest && (
          <p className="mt-8 font-mono text-[10px] theme-faint">
            error id: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
