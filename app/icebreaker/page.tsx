'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Vibrant, distinct colors for the game
const COLORS = [
  { name: 'Ruby', bg: 'bg-red-500', hex: '#ef4444', text: 'text-white' },
  { name: 'Sapphire', bg: 'bg-blue-500', hex: '#3b82f6', text: 'text-white' },
  { name: 'Emerald', bg: 'bg-emerald-500', hex: '#10b981', text: 'text-white' },
  { name: 'Amethyst', bg: 'bg-purple-500', hex: '#a855f7', text: 'text-white' },
  { name: 'Topaz', bg: 'bg-amber-500', hex: '#f59e0b', text: 'text-black' },
  { name: 'Rose', bg: 'bg-pink-500', hex: '#ec4899', text: 'text-white' },
];

const STORAGE_KEY = 'mah-icebreaker-color';

function getOrAssignColor(): typeof COLORS[0] {
  if (typeof window === 'undefined') return COLORS[0];
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    const found = COLORS.find(c => c.name === parsed.name);
    if (found) return found;
  }
  
  // Assign random color
  const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(randomColor));
  return randomColor;
}

export default function IcebreakerPage() {
  const [color, setColor] = useState<typeof COLORS[0] | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setColor(getOrAssignColor());
  }, []);

  if (!color) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div 
      className={`min-h-screen flex flex-col transition-colors duration-700 ${
        revealed ? color.bg : 'bg-zinc-950'
      }`}
    >
      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          {!revealed ? (
            <>
              <h1 className="text-3xl font-bold text-white mb-4">Ice Breaker</h1>
              <p className="text-zinc-400 mb-8">
                Tap to reveal your colour for tonight
              </p>
              <button
                onClick={() => setRevealed(true)}
                className="px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 font-bold text-lg rounded-full shadow-lg shadow-amber-500/30 hover:scale-105 transition-transform"
              >
                Reveal My Colour
              </button>
            </>
          ) : (
            <>
              {/* Color display */}
              <div className="mb-8">
                <div 
                  className="w-32 h-32 rounded-full mx-auto mb-4 shadow-2xl border-4 border-white/30"
                  style={{ backgroundColor: color.hex }}
                />
                <h1 className={`text-5xl font-bold mb-2 ${color.text}`}>
                  {color.name}
                </h1>
                <p className={`text-lg opacity-80 ${color.text}`}>
                  This is your colour for tonight
                </p>
              </div>

              {/* Mission */}
              <div className={`rounded-2xl p-6 mb-6 ${color.text} bg-black/20 backdrop-blur-sm`}>
                <h2 className="font-bold text-xl mb-3">Your Mission</h2>
                <p className="text-lg leading-relaxed opacity-90">
                  Find and introduce yourself to <strong>one person of each gender</strong> who shares your colour.
                </p>
              </div>

              {/* Forbidden question */}
              <div className="bg-black/30 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <p className={`text-sm font-medium ${color.text} opacity-90`}>
                  🚫 Forbidden question: <em>&quot;How do you know Abel/Owen?&quot;</em>
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Back link */}
      <div className="p-6 text-center">
        <Link 
          href="/" 
          className={`text-sm opacity-60 hover:opacity-100 transition-opacity ${
            revealed ? color.text : 'text-zinc-500'
          }`}
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
