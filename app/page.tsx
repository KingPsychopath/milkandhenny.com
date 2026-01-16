import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-md">
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

        {/* Game CTAs */}
        <div className="space-y-3 pt-4">
          <Link
            href="/icebreaker"
            className="w-full inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-lg rounded-2xl transition-all duration-200 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-[1.02]"
          >
            <span className="text-2xl">🎨</span>
            Ice Breaker
          </Link>
          
          <Link
            href="/best-dressed"
            className="w-full inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white font-bold text-lg rounded-2xl transition-all duration-200 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-[1.02]"
          >
            <span className="text-2xl">👑</span>
            Best Dressed
          </Link>
          
          <div className="pt-4">
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
