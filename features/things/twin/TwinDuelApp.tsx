import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useGamePreferences } from "../shared/useGamePreferences";
import { TwinCard } from "./TwinCard";
import { TwinRay } from "./TwinRay";
import { dealTwin, twinCardById, twinMatch } from "./twin-deck";
import { twinCooldownMs } from "./twin-rules";
import { twinSymbolName } from "./twin-symbols";
import { useTwinPalette } from "./useTwinPalette";
import type { TwinDealtCard } from "./types";

/**
 * One device.
 *
 * **Duel** is a face-off: your card against theirs, no middle card. Find the match, tap it on your own
 * card, and it goes to the bottom of their hand. First to empty wins.
 *
 * **Solo** keeps a middle card, because there is no opponent card to face.
 *
 * Both drop the heat structure. Two people sharing a screen can see each other, so the rounds — which
 * exist only to make a race fair across separate phones — are pure overhead. First correct tap takes it.
 *
 * Attribution is geometry: each seat taps its own card in its own half, and nothing shared is ever
 * tappable. That single rule (§3.2.1) is what makes one device work without seat buttons.
 */

/** Order 4: five symbols a card, and 21 cards covers both shapes below. */
const ORDER = 4;
const DUEL_PLAN = { order: ORDER, handSize: 10 } as const;
const SOLO_PLAN = { order: ORDER, handSize: 20 } as const;
const FLASH_MS = 460;
const SOLO_MISS_PENALTY_MS = 3_000;
/** Two evenly matched players can pass one card back and forth forever. */
const DUEL_CAP_MS = 4 * 60_000;

interface Seat {
  hand: TwinDealtCard[];
  connections: number;
  chain: number;
  longestChain: number;
  misses: number;
  cooldownUntil: number;
}

function toDealt(cards: readonly { id: string }[], seedFrom: number): TwinDealtCard[] {
  return cards.map((card, index) => ({
    cardId: card.id,
    symbolIds: twinCardById(ORDER, card.id)?.symbolIds ?? [],
    seed: seedFrom + index,
  }));
}

export function TwinDuelApp({
  onExit,
  mode = "duel",
}: {
  onExit: () => void;
  mode?: "duel" | "solo";
}) {
  const haptics = useWebHaptics();
  const boardRef = useRef<HTMLDivElement>(null);
  const palette = useTwinPalette();
  const [players, setPlayers] = useState<1 | 2>(mode === "solo" ? 1 : 2);
  const [round, setRound] = useState(0);
  const { preferences, set } = useGamePreferences("twin-solo", { bestMs: 0 });

  const deal = useMemo(() => {
    const plan = players === 2 ? DUEL_PLAN : SOLO_PLAN;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const dealt = dealTwin(plan, players, seed);
    const base = seed % 100_000;
    return {
      hands: dealt.hands.map((hand, index) => toDealt(hand, base + index * 100)),
      middle: toDealt([dealt.middle], base + 900)[0],
    };
    // `round` is the deliberate trigger for a fresh deal.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- round re-deals on purpose
  }, [players, round]);

  const [seats, setSeats] = useState<Seat[]>([]);
  const [middle, setMiddle] = useState<TwinDealtCard | null>(null);
  const [flash, setFlash] = useState<{ seat: number; symbolId: string } | null>(null);
  const [shake, setShake] = useState<{ seat: number; at: number } | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [penaltyMs, setPenaltyMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setSeats(
      deal.hands.map((hand) => ({
        hand,
        connections: 0,
        chain: 0,
        longestChain: 0,
        misses: 0,
        cooldownUntil: 0,
      })),
    );
    setMiddle(players === 1 ? deal.middle : null);
    setFlash(null);
    setWinner(null);
    setPenaltyMs(0);
    setStartedAt(Date.now());
    setElapsedMs(0);
  }, [deal, players]);

  useWakeLock(winner === null);

  useEffect(() => {
    if (winner !== null) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [startedAt, winner]);

  /** In a duel your card faces theirs; solo faces the middle card. */
  const opposite = useCallback(
    (seatIndex: number) =>
      players === 1 ? middle : (seats[seatIndex === 0 ? 1 : 0]?.hand[0] ?? null),
    [middle, players, seats],
  );

  const answerFor = useCallback(
    (seatIndex: number) => {
      const mine = seats[seatIndex]?.hand[0];
      const theirs = opposite(seatIndex);
      if (!mine || !theirs) return null;
      const left = twinCardById(ORDER, mine.cardId);
      const right = twinCardById(ORDER, theirs.cardId);
      return left && right ? twinMatch(left, right) : null;
    },
    [opposite, seats],
  );

  // The cap only decides a duel nobody finished.
  useEffect(() => {
    if (players !== 2 || winner !== null || elapsedMs < DUEL_CAP_MS) return;
    const [one, two] = seats;
    setWinner(one.hand.length <= two.hand.length ? 0 : 1);
  }, [elapsedMs, players, seats, winner]);

  const tap = (seatIndex: number, symbolId: string) => {
    if (winner !== null || flash !== null) return;
    const seat = seats[seatIndex];
    const now = Date.now();
    if (!seat || seat.cooldownUntil > now) {
      void haptics.trigger("warning");
      return;
    }
    if (symbolId !== answerFor(seatIndex)) {
      setSeats((current) =>
        current.map((entry, index) =>
          index === seatIndex
            ? {
                ...entry,
                misses: entry.misses + 1,
                chain: 0,
                cooldownUntil: now + twinCooldownMs(entry.misses + 1),
              }
            : entry,
        ),
      );
      if (players === 1) setPenaltyMs((current) => current + SOLO_MISS_PENALTY_MS);
      setShake({ seat: seatIndex, at: now });
      void haptics.trigger("warning");
      return;
    }

    // Hold the connection on screen before the card moves. The tap is already locked in.
    setFlash({ seat: seatIndex, symbolId });
    void haptics.trigger("success");
    window.setTimeout(() => {
      const given = seats[seatIndex].hand[0];
      setSeats((current) =>
        current.map((entry, index) => {
          if (index === seatIndex) {
            const chain = entry.chain + 1;
            return {
              ...entry,
              hand: entry.hand.slice(1),
              connections: entry.connections + 1,
              chain,
              longestChain: Math.max(entry.longestChain, chain),
              cooldownUntil: 0,
            };
          }
          // The card lands at the *bottom* of their hand. On top it would swap out the card they are
          // mid-scan on, which reads as the game cheating.
          return players === 2 && given ? { ...entry, hand: [...entry.hand, given] } : entry;
        }),
      );
      if (players === 1 && given) setMiddle(given);
      setFlash(null);
      if (seats[seatIndex].hand.length === 1) {
        setWinner(seatIndex);
        if (players === 1) {
          const total = Date.now() - startedAt + penaltyMs;
          if (preferences.bestMs === 0 || total < preferences.bestMs) set("bestMs", total);
        }
      }
    }, FLASH_MS);
  };

  const soloTotal = elapsedMs + penaltyMs;
  const remainingMs = Math.max(0, DUEL_CAP_MS - elapsedMs);

  return (
    <div className="things-game things-game--night twin twin-duel" ref={boardRef}>
      {players === 2 ? (
        <DuelSeat
          seat={seats[1]}
          index={1}
          slot="seat-two"
          flipped
          answer={flash?.seat === 1 ? flash.symbolId : null}
          shaking={shake?.seat === 1}
          locked={winner !== null || flash !== null}
          onTap={tap}
        />
      ) : (
        <header className="twin-duel-bar">
          <button type="button" className="twin-duel-exit" onClick={onExit}>
            ← twin
          </button>
          <p className="twin-duel-clock">
            <TextMorph as="span">{(soloTotal / 1_000).toFixed(1)}</TextMorph>s
            {penaltyMs > 0 ? (
              <span className="twin-duel-penalty"> +{penaltyMs / 1_000}s</span>
            ) : null}
          </p>
          <p className="twin-duel-best">
            {preferences.bestMs > 0
              ? `best ${(preferences.bestMs / 1_000).toFixed(1)}s`
              : "no best yet"}
          </p>
        </header>
      )}

      <div className="twin-duel-middle">
        {players === 2 ? (
          <button type="button" className="twin-duel-quit" onClick={onExit}>
            ← twin
          </button>
        ) : null}
        <button
          type="button"
          className="twin-duel-palette"
          aria-pressed={palette.colour}
          onClick={palette.toggle}
        >
          {palette.colour ? "colour" : "ink"}
        </button>
        {players === 1 && middle ? (
          <TwinCard
            card={middle}
            slot="middle"
            label="The card in the middle"
            focusSymbolId={flash?.symbolId ?? null}
            className="twin-card--middle"
          />
        ) : (
          <p className="twin-duel-divider">
            {remainingMs < 60_000
              ? `${Math.ceil(remainingMs / 1_000)}s left`
              : `${seats[0]?.hand.length ?? 0} — ${seats[1]?.hand.length ?? 0}`}
          </p>
        )}
        {flash ? (
          <TwinRay
            containerRef={boardRef}
            from={{ slot: flash.seat === 0 ? "seat-one" : "seat-two", symbolId: flash.symbolId }}
            to={{
              slot: players === 1 ? "middle" : flash.seat === 0 ? "seat-two" : "seat-one",
              symbolId: flash.symbolId,
            }}
            token={`${flash.seat}-${flash.symbolId}-${seats[flash.seat]?.hand[0]?.cardId ?? ""}`}
            durationMs={FLASH_MS}
          />
        ) : null}
      </div>

      <DuelSeat
        seat={seats[0]}
        index={0}
        slot="seat-one"
        answer={flash?.seat === 0 ? flash.symbolId : null}
        shaking={shake?.seat === 0}
        locked={winner !== null || flash !== null}
        onTap={tap}
      />

      {winner !== null ? (
        <div className="twin-duel-over" role="dialog" aria-modal="true">
          <div className="twin-duel-over-panel">
            <p className="twin-eyebrow">{seats[winner]?.connections ?? 0} connections</p>
            <h2 className="twin-title">
              {players === 1
                ? `Cleared in ${(soloTotal / 1_000).toFixed(1)}s`
                : seats[winner]?.hand.length === 0
                  ? `Seat ${winner + 1} is out of cards.`
                  : `Time. Seat ${winner + 1} has fewest.`}
            </h2>
            <p className="twin-lede">
              longest chain {seats[winner]?.longestChain ?? 0}
              {(seats[winner]?.misses ?? 0) > 0
                ? ` · ${seats[winner]?.misses} wrong`
                : " · flawless"}
            </p>
            <button
              type="button"
              className="twin-button twin-button--go"
              onClick={() => setRound((current) => current + 1)}
            >
              again
            </button>
            <button
              type="button"
              className="twin-button twin-button--quiet"
              onClick={() => setPlayers(players === 2 ? 1 : 2)}
            >
              {players === 2 ? "play on your own" : "play head to head"}
            </button>
            <button type="button" className="twin-leave" onClick={onExit}>
              back to twin
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DuelSeat({
  seat,
  index,
  slot,
  flipped = false,
  answer,
  shaking,
  locked,
  onTap,
}: {
  seat: Seat | undefined;
  index: number;
  slot: "seat-one" | "seat-two";
  flipped?: boolean;
  answer: string | null;
  shaking?: boolean;
  locked: boolean;
  onTap: (seat: number, symbolId: string) => void;
}) {
  const top = seat?.hand[0];
  const cooling = (seat?.cooldownUntil ?? 0) > Date.now();
  return (
    <section
      className={`twin-seat ${flipped ? "twin-seat--flipped" : ""}`}
      aria-label={`Seat ${index + 1}`}
    >
      <div className="twin-seat-meta">
        <span>{seat?.hand.length ?? 0} left</span>
        {seat && seat.chain > 1 ? <span className="twin-seat-chain">×{seat.chain}</span> : null}
        <span aria-live="polite">
          {answer ? twinSymbolName(answer) : cooling ? "wrong one" : ""}
        </span>
      </div>
      {top ? (
        <TwinCard
          card={top}
          slot={slot}
          label={`Seat ${index + 1} card`}
          onTap={(symbolId) => onTap(index, symbolId)}
          disabled={locked}
          focusSymbolId={answer}
          className={`twin-card--mine ${cooling ? "twin-card--cooling" : ""} ${
            shaking ? "twin-card--shake" : ""
          }`}
        />
      ) : (
        <p className="twin-note">out of cards</p>
      )}
    </section>
  );
}
