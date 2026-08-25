import { useState } from "react";
import { GameShell } from "../shared/GameShell";
import { SAME_BRAIN_QUESTIONS } from "./same-brain-questions";
import { Eyebrow, Headline } from "./SameBrainViews";

/**
 * The one-phone version: a question, and nothing else.
 *
 * No server and no room. Around one table the group decides which answers matched and keeps score
 * themselves, so this screen only holds up the question and gets out of the way.
 */
export function SoloSameBrain({ onExit }: { onExit: () => void }) {
  // Shuffled once per sitting so a group that plays twice does not get the same running order.
  const [deck, setDeck] = useState(() => shuffled(SAME_BRAIN_QUESTIONS));
  const [index, setIndex] = useState(0);
  const question = deck[index];

  const next = () => {
    if (index + 1 < deck.length) {
      setIndex(index + 1);
      return;
    }
    setDeck(shuffled(SAME_BRAIN_QUESTIONS));
    setIndex(0);
  };

  return (
    <GameShell tone="night">
      <div className="flex min-h-svh flex-col text-white">
        <header className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-4 font-mono text-xs text-white/45">
          <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
            ← same brain
          </button>
          <span className="tabular-nums text-white/30">
            {index + 1}/{deck.length}
          </span>
        </header>
        <main
          id="main"
          className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-20"
        >
          <Eyebrow>everybody answer at once</Eyebrow>
          <Headline>{question}</Headline>
          <p className="mt-6 font-mono text-xs leading-relaxed text-white/40">
            Count to three and say it together. Whoever matched gets a point — two if you did not
            all say the same thing.
          </p>
          <button
            type="button"
            onClick={next}
            className="mt-10 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-7 font-mono text-sm font-bold text-black transition-transform hover:scale-[1.01]"
          >
            next question
          </button>
        </main>
      </div>
    </GameShell>
  );
}

function shuffled(source: readonly string[]) {
  const deck = [...source];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}
