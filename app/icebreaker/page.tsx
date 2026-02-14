'use client';

import { useState, useSyncExternalStore, useCallback } from 'react';
import Link from 'next/link';
import { playFeedback } from '@/lib/feedback';

// Vibrant, distinct colors for the game (10 colors = ~20 people per color with 200 guests)
const COLORS = [
  { name: 'Ruby', bg: 'bg-red-500', hex: '#ef4444', text: 'text-white' },
  { name: 'Sapphire', bg: 'bg-blue-500', hex: '#3b82f6', text: 'text-white' },
  { name: 'Emerald', bg: 'bg-emerald-500', hex: '#10b981', text: 'text-white' },
  { name: 'Amethyst', bg: 'bg-purple-500', hex: '#a855f7', text: 'text-white' },
  { name: 'Topaz', bg: 'bg-amber-500', hex: '#f59e0b', text: 'text-black' },
  { name: 'Rose', bg: 'bg-pink-500', hex: '#ec4899', text: 'text-white' },
  { name: 'Coral', bg: 'bg-orange-500', hex: '#f97316', text: 'text-white' },
  { name: 'Teal', bg: 'bg-teal-500', hex: '#14b8a6', text: 'text-white' },
  { name: 'Indigo', bg: 'bg-indigo-500', hex: '#6366f1', text: 'text-white' },
  { name: 'Crimson', bg: 'bg-rose-600', hex: '#e11d48', text: 'text-white' },
] as const;

type Color = typeof COLORS[number];

const STORAGE_KEY = 'mah-icebreaker-color';

// Conversation starters - mix of fun, spicy, and thoughtful
const QUESTIONS = [
  "What's a hill you're willing to die on?",
  "What's your most unpopular opinion?",
  "What's the best meal you've ever had?",
  "What's something you're irrationally afraid of?",
  "What's your go-to karaoke song?",
  "What's the worst date you've ever been on?",
  "What's a skill you wish you had?",
  "What's the most spontaneous thing you've ever done?",
  "What's your guilty pleasure TV show?",
  "If you could live anywhere for a year, where?",
  "What's the best advice you've ever received?",
  "What's a trend you don't understand?",
  "What would your last meal be?",
  "What's something on your bucket list?",
  "What's your toxic trait you're aware of?",
  "What's the best concert you've been to?",
  "What's a movie you can quote from start to finish?",
  "What's the most overrated thing?",
  "If you had to sing one song for the rest of your life?",
  "What's something that instantly puts you in a good mood?",
];

function getRandomQuestion(exclude?: string): string {
  const available = exclude ? QUESTIONS.filter(q => q !== exclude) : QUESTIONS;
  return available[Math.floor(Math.random() * available.length)];
}

function getOrAssignColor(): Color {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const found = COLORS.find(c => c.name === parsed.name);
      if (found) return found;
    } catch {
      // Invalid JSON, assign new color
    }
  }
  
  // Assign random color
  const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(randomColor));
  return randomColor;
}

// Use useSyncExternalStore for localStorage (React 18 recommended pattern)
function useColor() {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
  }, []);
  
  const getSnapshot = useCallback(() => {
    return getOrAssignColor();
  }, []);
  
  const getServerSnapshot = useCallback((): Color => {
    return COLORS[0]; // Default for SSR
  }, []);
  
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default function IcebreakerPage() {
  const color = useColor();
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState(() => getRandomQuestion());

  const shuffleQuestion = () => {
    playFeedback('check-out'); // Light feedback
    setQuestion(getRandomQuestion(question));
  };

  return (
    <div 
      className={`min-h-screen flex flex-col transition-colors duration-700 ${
        revealed ? color.bg : 'bg-zinc-950'
      }`}
    >
      <main id="main" className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          {!revealed ? (
            <>
              <h1 className="text-3xl font-bold text-white mb-4">Ice Breaker</h1>
              <p className="text-zinc-400 mb-8">
                Tap to reveal your colour for tonight
              </p>
              <button
                onClick={() => {
                  playFeedback('reveal');
                  setRevealed(true);
                }}
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
              <div className={`rounded-2xl p-6 mb-4 ${color.text} bg-black/20 backdrop-blur-sm`}>
                <h2 className="font-bold text-xl mb-3">Your Mission</h2>
                <p className="text-lg leading-relaxed opacity-90">
                  Find and introduce yourself to <strong>one person of each gender</strong> who shares your colour.
                </p>
              </div>

              {/* Conversation starter */}
              <div className={`rounded-2xl p-5 mb-4 ${color.text} bg-black/20 backdrop-blur-sm`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium opacity-70">Ask them...</span>
                  <button
                    onClick={shuffleQuestion}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                    aria-label="Get new question"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <p className="text-lg font-medium leading-relaxed">
                  &ldquo;{question}&rdquo;
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
      </main>

      {/* Footer */}
      <div className="p-6 text-center space-y-3">
        {/* Footnote */}
        <p className={`text-xs max-w-xs mx-auto leading-relaxed opacity-70 ${
          revealed ? color.text : 'text-zinc-500'
        }`}>
          Remember: if someone says no, it means no. Be kind, and have fun. 💛
        </p>
        
        <Link 
          href="/party" 
          className={`text-sm opacity-60 hover:opacity-100 transition-opacity ${
            revealed ? color.text : 'text-zinc-500'
          }`}
        >
          ← Back to party
        </Link>
        <p className={`text-xs opacity-40 ${revealed ? color.text : 'text-zinc-600'}`}>
          © {new Date().getFullYear()} Milk & Henny
        </p>
      </div>
    </div>
  );
}
