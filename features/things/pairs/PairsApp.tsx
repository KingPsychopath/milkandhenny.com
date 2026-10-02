import { GameFrame, GameFrameHeader } from "@/features/things/shared/GameFrame";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useGameScreenHistory } from "../shared/useGameScreenHistory";
import { readStorageValue, writeStorageValue } from "../shared/game-storage.client";
import { PairsBoard } from "./PairsBoard";
import { PairsRaceLaunch } from "./PairsRaceLaunch";
import {
  applyPairsAction,
  createPairsGame,
  PAIRS_SIZES,
  pairsWinners,
  restorePairsRecord,
} from "./pairs-rules";
import type { PairsAction, PairsGame, PairsRecord, PairsSize } from "./pairs-rules";
import "./pairs.css";

const STORAGE_KEY = "things:pairs:table:v1";
const PREVIEW = createPairsGame(404, 3, ["you"]);
type Table = { record: PairsRecord; game: PairsGame };

export function PairsApp({
  initialRecord,
  recovery = true,
}: {
  initialRecord?: PairsRecord;
  recovery?: boolean;
}) {
  const [table, setTable] = useState<Table | null>(() =>
    initialRecord ? restorePairsRecord(initialRecord) : null,
  );
  const [saved, setSaved] = useState<Table | null>(null);
  const [friends, setFriends] = useState(false);
  const [raceMode, setRaceMode] = useState(false);
  const [names, setNames] = useState(["", ""]);
  const [pairCount, setPairCount] = useState<PairsSize>(6);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const game = table?.game;
  const solo = game?.names.length === 1;
  useGameScreenHistory({
    active: Boolean(table),
    screen: "pairs-table",
    onBack: () => {
      setTable(null);
      setExitOpen(false);
    },
  });

  useEffect(() => {
    if (!recovery) return;
    try {
      const raw = readStorageValue(sessionStorage, STORAGE_KEY);
      if (!raw) return;
      const value: unknown = JSON.parse(raw);
      if (
        !value ||
        typeof value !== "object" ||
        !("expiresAt" in value) ||
        typeof value.expiresAt !== "number" ||
        value.expiresAt <= Date.now() ||
        !("record" in value)
      )
        return;
      setSaved(restorePairsRecord(value.record));
    } catch {
      /* Storage recovery is optional; the table still works in a private browser. */
    }
  }, [recovery]);

  useEffect(() => {
    if (!table) return;
    setSaved(table);
    if (!recovery) return;
    try {
      const stored = writeStorageValue(
        sessionStorage,
        STORAGE_KEY,
        JSON.stringify({
          expiresAt: Date.now() + 6 * 60 * 60 * 1000,
          record: table.record,
        }),
      );
      setStorageWarning(!stored);
    } catch {
      setStorageWarning(true);
    }
  }, [table, recovery]);

  const act = (action: PairsAction) =>
    setTable((current) => {
      if (!current) return current;
      const next = applyPairsAction(current.game, action);
      return next === current.game
        ? current
        : {
            game: next,
            record: { ...current.record, actions: [...current.record.actions, action] },
          };
    });

  useEffect(() => {
    if (!solo || game?.phase !== "review") return;
    const timer = window.setTimeout(
      () => {
        setTable((current) => {
          if (!current || current.game !== game) return current;
          return {
            game: applyPairsAction(game, { type: "continue" }),
            record: {
              ...current.record,
              actions: [...current.record.actions, { type: "continue" }],
            },
          };
        });
      },
      game.outcome === "match" ? 1300 : 1400,
    );
    return () => window.clearTimeout(timer);
  }, [game, solo]);

  const focusStatus = game?.selected.length === 0;
  useEffect(() => {
    if (focusStatus) statusRef.current?.focus({ preventScroll: true });
  }, [focusStatus, game?.turn, game?.phase, game?.cards]);

  function start(playerNames: string[], size = pairCount) {
    try {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const next = createPairsGame(seed, size, playerNames);
      setTable({
        game: next,
        record: { version: 1, seed, pairCount: size, names: next.names, actions: [] },
      });
      setError(null);
      setExitOpen(false);
      setRulesOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not deal the cards");
    }
  }

  const currentName = game?.names[game.turn];
  const allMatched = game?.matched.length === game?.cards.length;
  const winners = game ? pairsWinners(game) : [];
  const headline = !game
    ? "A little memory.\nA little luck."
    : game.phase === "finished"
      ? solo
        ? "A clean sweep."
        : winners.length > 1
          ? "Honours shared."
          : `${winners[0]} takes the table.`
      : game.phase === "review"
        ? game.outcome === "match"
          ? allMatched
            ? "Last pair. Nicely done."
            : "A pair. All yours."
          : "Close. Keep it in mind."
        : solo
          ? game.selected.length
            ? "And its other half?"
            : "Find the pairs."
          : `${currentName}’s turn.`;

  return (
    <GameFrame className="pairs-app">
      <GameFrameHeader className="pairs-header">
        <Link to="/things">← things</Link>
        <span>
          milk & henny <span className="pairs-header-divider">/</span> pairs
        </span>
      </GameFrameHeader>
      <main id="main" className={`pairs-main ${table ? "pairs-main--playing" : ""}`}>
        <div className="pairs-intro">
          <p className="pairs-eyebrow">
            {!game
              ? "the memory card game · 1–6 people"
              : solo
                ? "a table for one"
                : "one table · play together"}
          </p>
          <h1 ref={statusRef} tabIndex={-1} className="pairs-title">
            {headline}
          </h1>
          <p className="pairs-description" role={game ? "status" : undefined} aria-live="polite">
            {!game
              ? raceMode
                ? "Flip two cards to find a matching rank. Clear your board first to win the round. Win two rounds to take the match."
                : friends
                  ? "Take turns finding matching ranks. Find a pair and go again. Collect the most pairs to win."
                  : "Flip two cards to find a matching rank. Remember each reveal and clear every pair in as few tries as you can."
              : game.phase === "finished"
                ? solo
                  ? `${game.cards.length / 2} pairs in ${game.tries} tries. ${game.tries === game.cards.length / 2 ? "Perfect memory." : "There’s always another shuffle."}`
                  : `${winners.join(" & ")} ${winners.length > 1 ? "share the win" : "wins"} with ${Math.max(...game.scores)} pairs. One more round?`
                : game.phase === "review"
                  ? game.outcome === "match"
                    ? `${currentName} found two ${game.cards[game.selected[0]].rank}s.${allMatched ? " The table is clear." : " Match a pair, keep your turn."}`
                    : solo
                      ? "Take a moment to remember them."
                      : `Remember those cards. ${game.names[(game.turn + 1) % game.names.length]} is up next.`
                  : solo
                    ? "Match the ranks. The suits can be different."
                    : `${game.selected.length ? "Choose one more card." : "Flip two cards with the same rank."} Everyone else: watch and remember.`}
          </p>
        </div>

        {!game ? (
          <div className="pairs-launch-layout">
            <div className="pairs-preview">
              <PairsBoard game={PREVIEW} preview />
            </div>
            <div className="pairs-setup">
              <form
                className="pairs-setup"
                onSubmit={(event) => {
                  event.preventDefault();
                  start(friends ? names : ["you"]);
                }}
              >
                <fieldset>
                  <legend>your table</legend>
                  <div className="pairs-options">
                    <button
                      type="button"
                      aria-pressed={!friends && !raceMode}
                      onClick={() => {
                        setFriends(false);
                        setRaceMode(false);
                      }}
                    >
                      just me <span>solo</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={friends && !raceMode}
                      onClick={() => {
                        setFriends(true);
                        setRaceMode(false);
                      }}
                    >
                      with friends <span>one device</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={raceMode}
                      onClick={() => {
                        setFriends(false);
                        setRaceMode(true);
                      }}
                    >
                      race a friend <span>two devices · rounds</span>
                    </button>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>how many pairs?</legend>
                  <div className="pairs-options pairs-options--sizes">
                    {PAIRS_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={size === pairCount}
                        onClick={() => setPairCount(size)}
                      >
                        {size}
                        <span>
                          {size === 3
                            ? "a quick hand"
                            : size === 6
                              ? "a little focus"
                              : "a real challenge"}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {friends ? (
                  <fieldset className="pairs-player-fields">
                    <legend>who’s playing?</legend>
                    <p>Take turns on one device. Most pairs wins. Match a pair and go again.</p>
                    {names.map((name, index) => (
                      <label key={index}>
                        <span>player {index + 1}</span>
                        <input
                          value={name}
                          placeholder={index === 0 ? "your name" : "their name"}
                          maxLength={24}
                          required
                          autoComplete="off"
                          onChange={(event) => {
                            setNames(
                              names.map((value, seat) =>
                                seat === index ? event.target.value : value,
                              ),
                            );
                            setError(null);
                          }}
                        />
                      </label>
                    ))}
                    <div className="pairs-player-actions">
                      {names.length < 6 ? (
                        <button
                          type="button"
                          className="mh-action mh-action--quiet"
                          onClick={() => setNames([...names, ""])}
                        >
                          + add player
                        </button>
                      ) : null}
                      {names.length > 2 ? (
                        <button
                          type="button"
                          className="mh-action mh-action--quiet"
                          onClick={() => setNames(names.slice(0, -1))}
                        >
                          remove last player
                        </button>
                      ) : null}
                    </div>
                  </fieldset>
                ) : null}
                {error ? <p role="alert">{error}</p> : null}
                {!raceMode ? (
                  <button className="mh-action mh-action--primary pairs-deal" type="submit">
                    {friends ? "deal us in" : "deal me in"}
                    <span aria-hidden="true">↗</span>
                  </button>
                ) : null}
                {saved ? (
                  <button
                    type="button"
                    className="mh-action mh-action--secondary"
                    onClick={() => {
                      setTable(saved);
                      setError(null);
                    }}
                  >
                    resume {saved.game.phase === "finished" ? "last result" : "saved table"}
                  </button>
                ) : null}
              </form>
              {raceMode ? <PairsRaceLaunch pairCount={pairCount} /> : null}
            </div>
          </div>
        ) : (
          <div className="pairs-play-layout">
            <section className="pairs-table" aria-label="The card table">
              <div className="pairs-table-meta">
                <span>
                  {game.matched.length / 2} / {game.cards.length / 2} pairs
                </span>
                <span>
                  {game.tries} {game.tries === 1 ? "try" : "tries"}
                </span>
              </div>
              {game.phase === "finished" ? (
                <div className="pairs-clear-table">
                  <span aria-hidden="true">
                    ♠ <span>♥</span>
                  </span>
                  <p>nothing left on the table.</p>
                </div>
              ) : (
                <PairsBoard
                  key={table?.record.seed}
                  game={game}
                  onFlip={(index) => act({ type: "flip", index })}
                />
              )}
              {game.phase === "review" && !solo ? (
                <button
                  type="button"
                  className="mh-action mh-action--primary pairs-next"
                  onClick={() => act({ type: "continue" })}
                >
                  {allMatched
                    ? "see the result"
                    : game.outcome === "match"
                      ? `${currentName}, go again`
                      : `next: ${game.names[(game.turn + 1) % game.names.length]}`}
                  <span aria-hidden="true">→</span>
                </button>
              ) : null}
              {game.phase === "finished" ? (
                <button
                  type="button"
                  className="mh-action mh-action--primary pairs-next"
                  onClick={() => start(game.names, table?.record.pairCount)}
                >
                  shuffle & play again <span aria-hidden="true">↗</span>
                </button>
              ) : null}
            </section>
            <aside className="pairs-sidebar" aria-label="Table scores and controls">
              <p className="pairs-eyebrow">{solo ? "your hand" : "around the table"}</p>
              <ol className="pairs-scores">
                {game.names.map((name, index) => (
                  <li
                    key={index}
                    className={
                      game.phase !== "finished" && game.turn === index ? "pairs-score--active" : ""
                    }
                  >
                    <span>
                      <span className="pairs-seat">{String(index + 1).padStart(2, "0")}</span>
                      {name}
                      {game.phase !== "finished" && game.turn === index ? (
                        <small>playing</small>
                      ) : null}
                    </span>
                    <strong>
                      {game.scores[index]}
                      <small>{game.scores[index] === 1 ? "pair" : "pairs"}</small>
                    </strong>
                  </li>
                ))}
              </ol>
              <div className="pairs-utilities">
                <button
                  type="button"
                  className="mh-action mh-action--quiet"
                  disabled={!game.previous}
                  onClick={() => act({ type: "undo" })}
                >
                  undo last turn
                </button>
                {!solo && game.phase === "playing" ? (
                  <button
                    type="button"
                    className="mh-action mh-action--quiet"
                    onClick={() => act({ type: "skip" })}
                  >
                    skip {currentName}’s turn
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mh-action mh-action--quiet"
                  aria-expanded={rulesOpen}
                  onClick={() => setRulesOpen(!rulesOpen)}
                >
                  how to play
                </button>
                <button
                  type="button"
                  className="mh-action mh-action--quiet"
                  onClick={() => setExitOpen(!exitOpen)}
                >
                  leave table
                </button>
              </div>
              {rulesOpen ? (
                <div className="pairs-note">
                  <p>Flip two cards. The same rank makes a pair, whatever the suit.</p>
                  <p>
                    {solo
                      ? "Clear the table in as few tries as you can."
                      : "A match scores one pair and keeps your turn. A miss passes the turn. Most pairs wins; equal scores share the win."}
                  </p>
                  <p>
                    No rush. Remember out loud, cheer a good guess, and keep an eye on the table.
                  </p>
                </div>
              ) : null}
              {exitOpen ? (
                <div className="pairs-note" role="group" aria-label="Leave this table">
                  <p>Your table will be here when you come back in this tab.</p>
                  <button
                    type="button"
                    className="mh-action mh-action--secondary"
                    onClick={() => {
                      setTable(null);
                      setExitOpen(false);
                    }}
                  >
                    back to setup
                  </button>
                  <button
                    type="button"
                    className="mh-action mh-action--quiet"
                    onClick={() => setExitOpen(false)}
                  >
                    keep playing
                  </button>
                </div>
              ) : null}
              {storageWarning ? (
                <p role="status" className="pairs-small">
                  This browser can’t save the table. Keep this tab open to finish your game.
                </p>
              ) : null}
            </aside>
          </div>
        )}
      </main>
    </GameFrame>
  );
}
