import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { getStored, setStored } from "@/lib/client/storage";
import { playFeedback } from "@/lib/client/feedback";
import { IcebreakerPairing } from "./IcebreakerPairing";
import { IcebreakerColourBook } from "./IcebreakerColourBook";
import {
  COLOURS,
  QUESTIONS,
  createPlayerId,
  parsePairingCode,
  type Colour,
  type IcebreakerPlayer,
} from "./icebreaker-pairing";
import { useIcebreakerLedger } from "./useIcebreakerLedger";
import { consumeLocationFragment } from "@/lib/client/url-fragment";

interface PairingLaunch {
  error: string | null;
  partner: IcebreakerPlayer | null;
}

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

function assignedPlayerId() {
  const stored = getStored("icebreakerPlayerId");
  if (stored && /^[A-Z2-9]{5}$/.test(stored)) return stored;
  const id = createPlayerId();
  setStored("icebreakerPlayerId", id);
  return id;
}

export function IcebreakerApp() {
  const colour = useAssignedColour();
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState<string>(() => QUESTIONS[0]);
  const [pairing, setPairing] = useState<PairingLaunch | null>(null);
  const [showingColourBook, setShowingColourBook] = useState(false);
  const [playerId] = useState(assignedPlayerId);
  const player = useMemo(() => ({ colour, id: playerId }), [colour, playerId]);
  const { ledger, addEncounter } = useIcebreakerLedger(player);

  useEffect(() => {
    const fragment = consumeLocationFragment();
    if (!fragment.startsWith("pair=")) return;
    const partner = parsePairingCode(fragment);
    setRevealed(true);
    setPairing({
      partner,
      error: partner ? null : "That pairing link isn't valid. Ask them to show a fresh code.",
    });
  }, []);

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
      style={{
        background:
          pairing || showingColourBook
            ? "var(--things-night)"
            : revealed
              ? colour.background
              : "var(--things-night)",
      }}
    >
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/60">
        <Link to="/things" className="min-h-11 inline-flex items-center hover:text-white">
          ← things
        </Link>
        <span>icebreaker</span>
      </header>

      <main id="main" className="flex-1 flex items-center justify-center px-6 py-10">
        {showingColourBook ? (
          <IcebreakerColourBook
            player={player}
            ledger={ledger}
            onClose={() => setShowingColourBook(false)}
          />
        ) : pairing ? (
          <IcebreakerPairing
            player={player}
            initialPartner={pairing.partner}
            initialError={pairing.error}
            onEncounter={addEncounter}
            onClose={() => setPairing(null)}
          />
        ) : !revealed ? (
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

            <button
              type="button"
              onClick={() => setPairing({ partner: null, error: null })}
              className="mt-5 min-h-12 font-mono text-sm font-semibold opacity-75 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current"
            >
              found someone? pair phones →
            </button>
            <p className="font-mono text-micro opacity-55">match your colour—or mix with anyone</p>
            <button
              type="button"
              onClick={() => setShowingColourBook(true)}
              className="mt-3 min-h-11 font-mono text-xs opacity-60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current"
            >
              my colour book · {ledger.encounters.length}
            </button>
          </section>
        )}
      </main>

      <footer className="p-6 text-center font-mono text-micro text-white/55">
        Be kind. A no is always enough.
      </footer>
    </div>
  );
}
