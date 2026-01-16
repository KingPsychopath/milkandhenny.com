import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
      <div className="text-center space-y-6 max-w-md">
        {/* 404 */}
        <div className="space-y-2">
          <h1 className="text-8xl font-bold text-amber-500/20">404</h1>
          <h2 className="text-2xl font-bold text-white -mt-4 relative">
            Page Not Found
          </h2>
        </div>

        <p className="text-zinc-400">
          Looks like you took a wrong turn. This page doesn&apos;t exist.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold rounded-full transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Go Home
          </Link>
          <Link
            href="/guestlist"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 font-semibold rounded-full transition-all duration-200"
          >
            Guest List
          </Link>
        </div>
      </div>
    </div>
  );
}

