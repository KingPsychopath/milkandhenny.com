import { useCallback, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { getStored, setStored } from "@/lib/client/storage";
import { playFeedback } from "@/lib/client/feedback";

const COLOURS = [
  { name: "Ruby", background: "oklch(0.58 0.22 25)", ink: "white" },
  { name: "Sapphire", background: "oklch(0.53 0.2 255)", ink: "white" },
  { name: "Emerald", background: "oklch(0.57 0.16 155)", ink: "white" },
  { name: "Amethyst", background: "oklch(0.56 0.2 305)", ink: "white" },
  { name: "Topaz", background: "oklch(0.78 0.16 78)", ink: "black" },
  { name: "Rose", background: "oklch(0.66 0.2 5)", ink: "white" },
  { name: "Coral", background: "oklch(0.68 0.19 45)", ink: "black" },
  { name: "Teal", background: "oklch(0.61 0.12 190)", ink: "black" },
] as const;

const QUESTIONS = [
  "What's a hill you're willing to die on?",
  "What's your most unpopular opinion?",
  "What's the best meal you've ever had?",
  "What's something you're irrationally afraid of?",
  "What's your go-to karaoke song?",
  "What's a skill you wish you had?",
  "What's the most spontaneous thing you've ever done?",
  "If you could live anywhere for a year, where would it be?",
  "What's the best advice you've ever received?",
  "What would your last meal be?",
  "What's something on your bucket list?",
  "What's the most overrated thing?",
] as const;

type Colour = (typeof COLOURS)[number];

function randomQuestion(exclude?: string) {
  const options = exclude ? QUESTIONS.filter((question) => question !== exclude) : QUESTIONS;
  return options[Math.floor(Math.random() * options.length)] ?? QUESTIONS[0];
}

function assignedColour(): Colour {
  const stored = getStored("icebreakerColor");
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === "object" && parsed && "name" in parsed) {
        const found = COLOURS.find((colour) => colour.name === parsed.name);
        if (found) return found;
      }
    } catch {
      // Replace invalid local data with a fresh assignment.
    }
  }

  const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)] ?? COLOURS[0];
  setStored("icebreakerColor", JSON.stringify({ name: colour.name }));
  return colour;
}

function useAssignedColour() {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  return useSyncExternalStore(subscribe, assignedColour, () => COLOURS[0]);
}

export function IcebreakerApp() {
  const colour = useAssignedColour();
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState<string>(() => QUESTIONS[0]);

  const handleReveal = () => {
    playFeedback("reveal");
    setQuestion(randomQuestion());
    setRevealed(true);
  };

  const handleShuffle = () => {
    playFeedback("check-out");
    setQuestion(randomQuestion(question));
  };

  return (
    <div
      className="min-h-[100svh] flex flex-col transition-colors duration-700"
      style={{ background: revealed ? colour.background : "var(--things-night)" }}
    >
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/60">
        <Link to="/things" className="min-h-11 inline-flex items-center hover:text-white">
          ← things
        </Link>
        <span>icebreaker</span>
      </header>

      <main id="main" className="flex-1 flex items-center justify-center px-6 py-10">
        {!revealed ? (
          <section className="text-center max-w-sm text-white" aria-labelledby="icebreaker-title">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/50">
              find your people
            </p>
            <h1 id="icebreaker-title" className="mt-4 font-serif text-5xl font-medium">
              Break the ice.
            </h1>
            <p className="mt-5 font-serif text-lg leading-relaxed text-white/65">
              Reveal a colour, find the people who match, and begin with a better question.
            </p>
            <button
              type="button"
              onClick={handleReveal}
              className="mt-9 min-h-14 rounded-full bg-white px-8 font-mono text-sm font-semibold text-black shadow-xl transition-transform hover:scale-[1.03]"
            >
              reveal my colour
            </button>
          </section>
        ) : (
          <section
            className="w-full max-w-sm text-center"
            style={{ color: colour.ink }}
            aria-labelledby="colour-title"
          >
            <div
              className="mx-auto h-24 w-24 rounded-full border border-white/35 shadow-2xl"
              style={{ background: colour.background }}
              aria-hidden="true"
            />
            <p className="mt-6 font-mono text-micro uppercase tracking-[0.2em] opacity-65">
              your colour
            </p>
            <h1 id="colour-title" className="mt-1 font-serif text-6xl font-semibold">
              {colour.name}
            </h1>

            <div className="mt-8 rounded-3xl bg-black/20 p-6 text-left backdrop-blur-sm">
              <h2 className="font-mono text-micro uppercase tracking-[0.18em] opacity-65">
                the mission
              </h2>
              <p className="mt-3 font-serif text-xl leading-snug">
                Find someone who shares your colour. Introduce yourselves, then ask…
              </p>
            </div>

            <div className="mt-3 rounded-3xl bg-black/20 p-6 text-left backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-mono text-micro uppercase tracking-[0.18em] opacity-65">
                  conversation starter
                </h2>
                <button
                  type="button"
                  onClick={handleShuffle}
                  className="min-h-11 min-w-11 rounded-full bg-white/15 px-3 font-mono text-lg hover:bg-white/25"
                  aria-label="Get another question"
                >
                  ↻
                </button>
              </div>
              <p className="mt-3 font-serif text-xl leading-snug">“{question}”</p>
            </div>
          </section>
        )}
      </main>

      <footer className="p-6 text-center font-mono text-micro text-white/55">
        Be kind. A no is always enough.
      </footer>
    </div>
  );
}
