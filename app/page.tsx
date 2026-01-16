import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-md">
        {/* Circular Logo */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10 p-2 shadow-2xl shadow-amber-500/10">
            <Image
              src="/MAHLogo.svg"
              alt="Milk & Henny Logo"
              width={80}
              height={80}
              className="w-full h-full object-contain"
              priority
            />
          </div>
        </div>

        {/* Text Logo */}
        <div className="px-4">
          <Image
            src="/MAHtext.svg"
            alt="Milk & Henny"
            width={320}
            height={70}
            className="w-full h-auto"
            priority
          />
        </div>

        {/* Tagline */}
        <p className="text-amber-400/90 text-lg font-medium tracking-widest uppercase">
          First Ever Birthday
        </p>

        {/* CTAs */}
        <div className="space-y-4 pt-4">
          <Link
            href="/icebreaker"
            className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-lg rounded-full transition-all duration-200 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-105"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Ice Breaker Game
          </Link>
          
          <div className="pt-2">
            <Link
              href="/guestlist"
              className="text-zinc-500 hover:text-amber-400 text-sm transition-colors"
            >
              Staff Check-In →
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-8 text-zinc-600 text-xs">
          © {new Date().getFullYear()} Milk & Henny
        </div>
      </div>
    </div>
  );
}
