import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rankTwinFinish } from "./twin-rules";
import { readTwinLogFn } from "./twin-room.functions";
import { TwinConstellation } from "./TwinConstellation";
import { TwinHeader } from "./TwinViews";
import type { TwinLoggedHeat, TwinSnapshot } from "./types";

export function TwinFinished({
  snapshot,
  playerId,
  playerToken,
  message,
  pending,
  onPlayAgain,
  onBackToLobby,
}: {
  snapshot: TwinSnapshot;
  playerId: string;
  playerToken: string;
  message: string | null;
  pending: boolean;
  onPlayAgain: () => void;
  onBackToLobby: () => void;
}) {
  const [heats, setHeats] = useState<TwinLoggedHeat[] | null>(null);
  const [logFailed, setLogFailed] = useState(false);

  /**
   * The log is fetched once, here, and never during play — it is the six hundred records the room
   * snapshot deliberately does not carry.
   */
  useEffect(() => {
    let active = true;
    readTwinLogFn({ data: { roomId: snapshot.roomId, playerId, playerToken } })
      .then((result) => {
        if (!active) return;
        if (result.ok) setHeats(result.heats);
        else setLogFailed(true);
      })
      .catch(() => {
        if (active) setLogFailed(true);
      });
    return () => {
      active = false;
    };
  }, [playerId, playerToken, snapshot.roomId]);

  const ending = snapshot.ending;
  const ranked = rankTwinFinish(
    snapshot.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      cardsLeft: player.cardsLeft,
      place: player.place,
      connections: player.connections,
      misses: player.misses,
      longestChain: player.longestChain,
      totalElapsedMs: 0,
      bestElapsedMs: null,
    })),
  );

  return (
    <div className="things-game things-game--night twin">
      <TwinHeader roomId={snapshot.roomId} right={`game ${snapshot.gameNumber} · finished`} />
      <main id="main" className="twin-finished">
        <p className="twin-eyebrow">
          {ending?.heatCount ?? 0} heats · {snapshot.players.length} playing
        </p>
        <h1 className="twin-title">{ending?.headline ?? "That is the game."}</h1>

        {ending && ending.awards.length > 0 ? (
          <ul className="twin-awards" aria-label="Awards">
            {ending.awards.map((award) => (
              <li key={award.label}>
                <span className="twin-award-label">{award.label}</span>
                <span className="twin-award-name">{award.name}</span>
                <span className="twin-award-detail">{award.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <ol className="twin-final" aria-label="Final order">
          {ranked.map((player, index) => (
            <li key={player.playerId} data-you={player.playerId === playerId ? "true" : "false"}>
              <span className="twin-final-place">{String(index + 1).padStart(2, "0")}</span>
              <span className="twin-final-name">
                {player.name}
                {player.playerId === playerId ? " · you" : ""}
              </span>
              <span className="twin-final-stat">
                {player.cardsLeft === 0 ? "out" : `${player.cardsLeft} left`}
                <span className="twin-final-sub">
                  {player.connections} found · longest {player.longestChain}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {heats ? (
          <TwinConstellation
            heats={heats}
            players={snapshot.players.map(({ id, name }) => ({ id, name }))}
          />
        ) : logFailed ? (
          <p className="twin-note">The replay could not be loaded.</p>
        ) : (
          <p className="twin-note" aria-busy="true">
            drawing the constellation…
          </p>
        )}

        {snapshot.canControl ? (
          <>
            <button
              type="button"
              onClick={onPlayAgain}
              disabled={pending}
              className="twin-button twin-button--go"
            >
              {pending ? "dealing…" : "play again · same people"}
            </button>
            <button
              type="button"
              onClick={onBackToLobby}
              disabled={pending}
              className="twin-button twin-button--quiet"
            >
              back to the lobby to add people
            </button>
          </>
        ) : (
          <p aria-live="polite" className="twin-note">
            waiting for the host to start another game
          </p>
        )}
        <p aria-live="polite" className="twin-message">
          {message}
        </p>
        <Link to="/things/twin" className="twin-leave">
          leave the room
        </Link>
      </main>
    </div>
  );
}
