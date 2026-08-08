import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { GameShell } from "../shared/GameShell";
import { useWakeLock } from "@/hooks/useWakeLock";
import { liarsImposterBlurb, liarsImposterRange } from "./liars-rules";
import { liarsPassPhoneDeal, type LiarsPassPhoneSeat } from "./pass-phone.client";
import { ActionButton, Eyebrow, Headline } from "./LiarsViews";

/**
 * Imposter on one phone.
 *
 * The room version needs everyone to have a device, a code, and a signal. Around a table that is
 * three minutes of admin before anybody has said anything — so this is the version where one person
 * holds the phone, everyone taps to see their own word, and then the phone goes face down and you
 * argue like people did before any of this existed. No room, no server, no network at all.
 *
 * Mafia deliberately has no equivalent: its secrets have to survive every night, and passing one
 * phone round in the dark five times is worse than not playing.
 */
type Stage = "setup" | "passing" | "revealed" | "playing";

export function LiarsPassPhoneApp() {
  const [players, setPlayers] = useState(6);
  const [imposters, setImposters] = useState(1);
  const [names, setNames] = useState<string[]>([]);
  const [seats, setSeats] = useState<LiarsPassPhoneSeat[]>([]);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("setup");

  useWakeLock(stage !== "setup");
  const range = liarsImposterRange(players);
  const imposterCount = Math.min(range.max, Math.max(range.min, imposters));

  const start = useCallback(() => {
    const dealt = liarsPassPhoneDeal(players, imposterCount, names);
    setSeats(dealt);
    setIndex(0);
    setStage("passing");
  }, [imposterCount, names, players]);

  const seat = seats[index];

  if (stage === "setup")
    return (
      <Shell>
        <Eyebrow>imposter · one phone</Eyebrow>
        <Headline>Pass it round</Headline>
        <p className="mt-4 font-serif text-lg text-white/65">{liarsImposterBlurb(imposterCount)}</p>
        <p className="mt-2 font-mono text-xs text-white/40">
          nobody needs an app, a code or a signal — just this phone and a circle
        </p>

        <div className="mt-8">
          <label className="font-mono text-xs text-white/55">
            <span className="block pb-2">how many of you · {players}</span>
            <input
              type="range"
              min={3}
              max={16}
              value={players}
              onChange={(event) => setPlayers(Number(event.target.value))}
              className="w-full accent-[var(--things-amber)]"
            />
          </label>
        </div>

        {range.max > 1 ? (
          <div className="mt-6">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">
              how many imposters
            </p>
            <div className="mt-2 flex gap-2">
              {Array.from({ length: range.max }, (_, offset) => offset + 1).map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={imposterCount === count}
                  onClick={() => setImposters(count)}
                  className={`min-h-11 flex-1 rounded-full border px-4 font-mono text-xs ${
                    imposterCount === count
                      ? "border-[var(--things-amber)] text-[var(--things-amber)]"
                      : "border-white/20 text-white/55"
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <NameList players={players} names={names} onChange={setNames} />

        <div className="mt-8">
          <ActionButton onClick={start}>deal</ActionButton>
        </div>
      </Shell>
    );

  if (stage === "playing")
    return (
      <Shell>
        <Eyebrow>everyone has their word</Eyebrow>
        <Headline>Put the phone down</Headline>
        <p className="mt-4 font-serif text-lg text-white/65">
          Go round the circle. One word each, out loud. Then argue, then point at somebody — all of
          it off the screen.
        </p>
        <div className="mt-8 space-y-3">
          <ActionButton onClick={() => setStage("revealed")} tone="ghost">
            show me who was who
          </ActionButton>
          <ActionButton onClick={start}>deal again</ActionButton>
        </div>
      </Shell>
    );

  if (stage === "revealed")
    return (
      <Shell>
        <Eyebrow>that game</Eyebrow>
        <Headline>Here is who was lying</Headline>
        {seats[0] ? (
          <p className="mt-3 font-mono text-xs text-white/40">
            {seats[0].category} · the word was{" "}
            {seats.find(({ word }) => word !== null)?.word ?? "—"}
          </p>
        ) : null}
        <ul className="mt-6 border-t border-white/10">
          {seats.map((each) => (
            <li
              key={each.index}
              className="flex items-baseline gap-3 border-b border-white/10 py-3"
            >
              <span className="font-serif text-lg">{each.name}</span>
              <span
                className={`ml-auto font-mono text-xs uppercase tracking-[0.14em] ${
                  each.word === null ? "text-[var(--liars-dead)]" : "text-white/50"
                }`}
              >
                {each.word === null ? "imposter" : each.word}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <ActionButton onClick={start}>deal again</ActionButton>
        </div>
      </Shell>
    );

  // Passing: one seat at a time, hold to see it, and the phone never shows two people's words on
  // one screen.
  return (
    <Shell>
      <Eyebrow>
        {index + 1} of {seats.length}
      </Eyebrow>
      <Headline>{seat?.name}</Headline>
      <p className="mt-4 font-serif text-lg text-white/65">
        Hand the phone to {seat?.name}. Everyone else look away.
      </p>
      <HoldToSee
        key={seat?.index}
        word={seat?.word ?? null}
        category={seat?.category ?? ""}
        board={seat?.board ?? []}
        onDone={() => {
          if (index + 1 >= seats.length) setStage("playing");
          else setIndex(index + 1);
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <GameShell tone="night">
      <div className="flex min-h-0 flex-1 flex-col text-white">
        <header className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pt-4 font-mono text-xs text-white/45">
          <Link to="/things/liars" className="inline-flex min-h-11 items-center">
            ← liars
          </Link>
          <span>one phone</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-24 pt-6">
          {children}
        </main>
      </div>
    </GameShell>
  );
}

function HoldToSee({
  word,
  category,
  board,
  onDone,
}: {
  word: string | null;
  category: string;
  board: string[];
  onDone: () => void;
}) {
  const [held, setHeld] = useState(false);
  const [seen, setSeen] = useState(false);

  return (
    <>
      <div
        onPointerDown={() => {
          setHeld(true);
          setSeen(true);
        }}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
        className="mt-8 min-h-56 select-none border-y border-white/15 py-12 text-center"
      >
        {held ? (
          <>
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">
              the category is
            </p>
            <p className="mt-1 font-serif text-2xl text-white/85">{category}</p>
            {word === null ? (
              <>
                <p className="mt-6 font-serif text-4xl font-semibold text-[var(--liars-dead)]">
                  you have no word
                </p>
                <p className="mx-auto mt-3 max-w-sm font-serif text-base text-white/70">
                  It is one of these. Work out which.
                </p>
              </>
            ) : (
              <>
                <p className="mt-6 font-mono text-micro uppercase tracking-[0.2em] text-white/40">
                  the word is
                </p>
                <p className="mt-2 font-serif text-6xl font-semibold leading-tight text-[var(--things-amber)]">
                  {word}
                </p>
              </>
            )}
            {board.length > 0 ? (
              <ul className="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-x-4 text-left">
                {board.map((candidate) => (
                  <li
                    key={candidate}
                    className="border-b border-white/10 py-1.5 font-serif text-sm text-white/60"
                  >
                    {candidate}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="pt-10 font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            hold to reveal
          </p>
        )}
      </div>
      <div className="mt-6">
        <ActionButton disabled={!seen} onClick={onDone}>
          {seen ? "got it — pass it on" : "hold the card first"}
        </ActionButton>
      </div>
    </>
  );
}

/** Optional. Most groups will not bother, and "player 3" works fine when you are all in a circle. */
function NameList({
  players,
  names,
  onChange,
}: {
  players: number;
  names: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 border-t border-white/15 pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
      >
        {open ? "hide names" : "use names instead of numbers"}
      </button>
      {open ? (
        <ul className="mt-2">
          {Array.from({ length: players }, (_, index) => (
            <li key={index} className="border-t border-white/10 py-1">
              <input
                value={names[index] ?? ""}
                placeholder={`player ${index + 1}`}
                maxLength={24}
                onChange={(event) => {
                  const next = [...names];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                className="min-h-11 w-full bg-transparent font-serif text-base text-white outline-none placeholder:text-white/25"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
