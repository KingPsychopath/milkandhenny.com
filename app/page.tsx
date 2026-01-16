import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
      <div className="text-center space-y-8 max-w-lg">
        {/* Logo/Brand */}
        <div className="space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/20">
            <span className="text-3xl font-bold text-zinc-950">M&H</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            Milk & Henny
          </h1>
          <p className="text-amber-400/80 text-lg font-medium tracking-wide uppercase">
            First Ever Birthday
          </p>
        </div>

        {/* Decorative line */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-amber-500/50" />
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-amber-500/50" />
        </div>

        {/* CTA */}
        <div className="space-y-4">
          <Link
            href="/guestlist"
            className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-lg rounded-full transition-all duration-200 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-105"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Door Staff Check-In
          </Link>
          <p className="text-zinc-500 text-sm">
            Staff access only
          </p>
        </div>

        {/* Footer */}
        <div className="pt-8 text-zinc-600 text-xs">
          © {new Date().getFullYear()} Milk & Henny
        </div>
      </div>
    </div>
  );
}
