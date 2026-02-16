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
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-white/10 rounded-3xl p-8 bg-white/5">
        <h2 className="text-lg font-semibold">Best dressed error</h2>
        <p className="mt-2 text-sm text-stone-300">Something went wrong. Try again.</p>
        <button
          onClick={reset}
          className="mt-6 w-full py-3 rounded-2xl bg-purple-600 text-white font-semibold hover:bg-purple-500 transition-colors"
        >
          Retry
        </button>
        <Link href="/party" className="mt-4 block text-center text-sm text-stone-400 hover:text-stone-200">
          ← Back to party
        </Link>
      </div>
    </div>
  );
}
