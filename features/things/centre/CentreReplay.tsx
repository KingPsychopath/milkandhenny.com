import { useEffect, useMemo, useRef, useState } from "react";
import { MazeBoard, type MazeRouteLayer } from "./MazeBoard";
import type { CentreMaze, CentreReplayPlayer } from "./types";

function formatTime(milliseconds: number) {
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

export function CentreReplay({
  maze,
  players,
  title = "How the race unfolded.",
}: {
  maze: CentreMaze;
  players: CentreReplayPlayer[];
  title?: string;
}) {
  const duration = Math.max(1, ...players.map(({ elapsedMs }) => elapsedMs));
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [visible, setVisible] = useState(() => new Set(players.map(({ playerId }) => playerId)));
  const previousFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (frameTime: number) => {
      const previous = previousFrame.current ?? frameTime;
      previousFrame.current = frameTime;
      setTime((current) => {
        const next = Math.min(duration, current + (frameTime - previous) * speed);
        if (next >= duration) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      previousFrame.current = null;
    };
  }, [duration, playing, speed]);

  const layers = useMemo<MazeRouteLayer[]>(
    () =>
      players
        .filter(({ playerId }) => visible.has(playerId))
        .map((player) => ({
          id: player.playerId,
          colour: player.colour,
          route: player.route,
          untilMs: time,
        })),
    [players, time, visible],
  );

  const restart = () => {
    setTime(0);
    setPlaying(true);
  };

  return (
    <section className="centre-replay" aria-labelledby="centre-replay-title">
      <p className="centre-eyebrow">route replay</p>
      <h2 id="centre-replay-title" className="centre-title centre-title--small">
        {title}
      </h2>
      <MazeBoard
        maze={maze}
        entranceIndex={0}
        phase="replay"
        startsAt={null}
        route={{ segments: [], wallHits: 0 }}
        routeLayers={layers}
      />
      <div className="centre-replay-time" aria-live="off">
        <span>{formatTime(time)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={duration}
        step={10}
        value={time}
        aria-label="Replay position"
        onChange={(event) => {
          setPlaying(false);
          setTime(Number(event.target.value));
        }}
        className="centre-replay-slider"
      />
      <div className="centre-replay-controls">
        <button
          type="button"
          onClick={() => {
            if (time >= duration) restart();
            else setPlaying((current) => !current);
          }}
        >
          {playing ? "pause" : time >= duration ? "again" : "play"}
        </button>
        {[0.5, 1, 2, 4].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={speed === value}
            onClick={() => setSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
      <div className="centre-replay-players" aria-label="Visible routes">
        {players.map((player) => (
          <button
            key={player.playerId}
            type="button"
            aria-pressed={visible.has(player.playerId)}
            className={`centre-player-chip centre-colour-${player.colour}`}
            onClick={() =>
              setVisible((current) => {
                const next = new Set(current);
                if (next.has(player.playerId)) next.delete(player.playerId);
                else next.add(player.playerId);
                return next;
              })
            }
          >
            <span aria-hidden="true" />
            {player.name} · {player.finished ? formatTime(player.elapsedMs) : "DNF"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setVisible(new Set(players.map(({ playerId }) => playerId)))}
          className="centre-player-chip"
        >
          show all
        </button>
      </div>
      <ol className="centre-results" aria-label="Race results">
        {players
          .toSorted((left, right) => left.place - right.place)
          .map((player) => (
            <li key={player.playerId}>
              <span>{player.place}</span>
              <strong>{player.name}</strong>
              <span>{player.finished ? formatTime(player.elapsedMs) : "DNF"}</span>
              <span>
                {player.route.wallHits} walls · {player.route.segments.length - 1} resets
              </span>
            </li>
          ))}
      </ol>
    </section>
  );
}
