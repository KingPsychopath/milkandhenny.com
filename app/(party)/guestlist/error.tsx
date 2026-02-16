"use client";

import { useEffect } from "react";

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
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-900">Guest list error</h2>
        <p className="mt-2 text-sm text-stone-600">Something went wrong. Try again.</p>
        <button
          onClick={reset}
          className="mt-6 w-full py-3 rounded-2xl bg-amber-600 text-white font-semibold hover:bg-amber-500 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
