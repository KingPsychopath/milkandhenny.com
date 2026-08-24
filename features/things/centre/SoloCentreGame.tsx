import { useEffect, useMemo, useRef, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { gameBrowserKey } from "../shared/multiplayer-keys";
import { useGameSound } from "../shared/useGameSound";
import { CentreReplay } from "./CentreReplay";
import { CentreReportButton } from "./CentreReportButton";
import { centreEntrancePoint, generateCentreMaze } from "./centre-generator";
import { saveSoloCentreReplay, type SoloCentreReplay } from "./centre-replays.client";
import { playCentreSound, primeCentreAudio } from "./centre-sound.client";
import { GiveUpControl } from "../shared/GiveUpControl";
import { MazeBoard, type MazeRouteLayer } from "./MazeBoard";
import type { CentreDifficulty, CentreReplayPlayer, CentreRoute } from "./types";

type SoloPhase = "arming" | "countdown" | "racing" | "finished";

function replayPlayer(replay: SoloCentreReplay): CentreReplayPlayer {
  return {
    playerId: replay.id,
    name: "you",
    colour: 0,
    entranceIndex: 0,
    elapsedMs: replay.elapsedMs,
    place: 1,
    finished: true,
    route: replay.route,
  };
}

export function SoloCentreGame({
  seed,
  difficulty,
  ghost,
  onExit,
  onNewMaze,
}: {
  seed: number;
  difficulty: CentreDifficulty;
  ghost?: SoloCentreReplay | null;
  onExit: () => void;
  onNewMaze: () => void;
}) {
  const maze = useMemo(
    () => generateCentreMaze({ seed, difficulty, playerCount: 1 }),
    [difficulty, seed],
  );
  const haptics = useWebHaptics();
  const sound = useGameSound(gameBrowserKey("centre", 1, "sound"), ["all", "off"]);
  const [phase, setPhase] = useState<SoloPhase>("arming");
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [route, setRoute] = useState<CentreRoute>({ segments: [], wallHits: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState<SoloCentreReplay | null>(null);
  const [ghostVisible, setGhostVisible] = useState(Boolean(ghost));
  const [resetNonce, setResetNonce] = useState(0);
  const previousCount = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "countdown" || !startsAt) return;
    const timer = window.setInterval(() => {
      const remaining = startsAt - Date.now();
      const count = Math.min(3, Math.max(1, Math.ceil(remaining / 1_000)));
      if (remaining > 0 && previousCount.current !== count) {
        previousCount.current = count;
        playCentreSound("count", sound.effects);
        void haptics.trigger(count === 1 ? "medium" : "selection");
      }
      if (remaining <= 0) {
        window.clearInterval(timer);
        setPhase("racing");
        playCentreSound("go", sound.effects);
        void haptics.trigger("heavy");
      }
    }, 25);
    return () => window.clearInterval(timer);
  }, [haptics, phase, sound.effects, startsAt]);

  useEffect(() => {
    if (phase !== "racing" || !startsAt) return;
    let frame = 0;
    const tick = () => {
      setElapsed(Date.now() - startsAt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, startsAt]);

  const arm = (armed: boolean) => {
    if (armed && phase === "arming") {
      primeCentreAudio();
      setStartsAt(Date.now() + 3_300);
      setRoute({ segments: [], wallHits: 0 });
      previousCount.current = null;
      setPhase("countdown");
    }
  };

  const finish = (finishedRoute: CentreRoute) => {
    if (phase !== "racing") return;
    const elapsedMs = finishedRoute.segments.at(-1)?.at(-1)?.t ?? elapsed;
    const replay: SoloCentreReplay = {
      id: `${maze.hash}:${Date.now()}`,
      seed,
      difficulty,
      mazeHash: maze.hash,
      elapsedMs,
      route: finishedRoute,
      savedAt: Date.now(),
    };
    setElapsed(elapsedMs);
    setSaved(replay);
    setPhase("finished");
    playCentreSound("finish", sound.effects);
    void haptics.trigger("success");
    void saveSoloCentreReplay(replay).catch(() => undefined);
  };

  if (phase === "finished" && saved)
    return (
      <div className="things-game things-game--night centre">
        <header className="centre-header">
          <button type="button" onClick={onExit}>
            ← leave
          </button>
          <span>solo finish</span>
        </header>
        <main id="main" className="centre-finished">
          <p className="centre-eyebrow">centre reached</p>
          <h1 className="centre-finish-time">{(saved.elapsedMs / 1_000).toFixed(2)}s</h1>
          <p className="centre-note">
            {saved.route.wallHits} wall contacts · {saved.route.segments.length - 1} resets
            {ghost
              ? ` · ${(saved.elapsedMs - ghost.elapsedMs) / 1_000 >= 0 ? "+" : ""}${((saved.elapsedMs - ghost.elapsedMs) / 1_000).toFixed(2)}s against your ghost`
              : ""}
          </p>
          <div className="centre-actions">
            <button
              type="button"
              className="centre-button centre-button--go"
              onClick={() => {
                setSaved(null);
                setElapsed(0);
                setStartsAt(null);
                setRoute({ segments: [], wallHits: 0 });
                setPhase("arming");
              }}
            >
              same maze again
            </button>
            <button type="button" className="centre-button" onClick={onNewMaze}>
              new maze
            </button>
          </div>
          <CentreReplay
            maze={maze}
            players={[
              replayPlayer(saved),
              ...(ghost ? [{ ...replayPlayer(ghost), name: "your ghost", colour: 1 }] : []),
            ]
              .toSorted((left, right) => left.elapsedMs - right.elapsedMs)
              .map((player, index) => ({ ...player, place: index + 1 }))}
            title="Every turn, played back."
          />
          <CentreReportButton phase="finished" />
        </main>
      </div>
    );

  const ghostLayers: MazeRouteLayer[] =
    ghost && ghostVisible && (phase === "racing" || phase === "countdown")
      ? [{ id: ghost.id, colour: 1, route: ghost.route, untilMs: elapsed, muted: true }]
      : [];

  return (
    <>
      <div className="things-game things-game--night centre">
        <header className="centre-header">
          <button type="button" onClick={onExit}>
            ← leave
          </button>
          <span>
            {phase === "racing" ? `${(elapsed / 1_000).toFixed(1)}s` : `difficulty ${difficulty}`}
          </span>
        </header>
        <main id="main" className="centre-race">
          <div className="centre-race-copy">
            <p className="centre-eyebrow">outside to centre</p>
            <h1 className="centre-race-title">
              {phase === "arming" ? "Find your line." : phase === "countdown" ? "Get set." : "GO"}
            </h1>
          </div>
          <MazeBoard
            maze={maze}
            entranceIndex={0}
            phase={phase}
            startsAt={startsAt}
            route={route}
            routeLayers={ghostLayers}
            resetNonce={resetNonce}
            onRouteChange={setRoute}
            onArmChange={arm}
            onCollision={() => {
              void haptics.trigger("nudge");
              playCentreSound("wall", sound.effects);
            }}
            onFinish={finish}
          />
          <p id="centre-instructions" className="centre-note centre-note--centre">
            Tap the start when you’re ready. At GO, drag towards the centre. Lift when you need to,
            then continue from your route head.
          </p>
          <div className="centre-race-controls">
            {ghost ? (
              <button
                type="button"
                aria-pressed={ghostVisible}
                onClick={() => setGhostVisible((value) => !value)}
              >
                {ghostVisible ? "ghost on" : "ghost off"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const point = { ...centreEntrancePoint(maze, 0), t: Math.max(0, elapsed) };
                setResetNonce((nonce) => nonce + 1);
                setRoute((current) => ({ ...current, segments: [...current.segments, [point]] }));
                void haptics.trigger("medium");
              }}
              disabled={phase !== "racing"}
            >
              restart route
            </button>
            <GiveUpControl
              tone="dark"
              description="Your route will be discarded and you will return to Centre."
              onGiveUp={() => {
                onExit();
                return true;
              }}
            />
            <button
              type="button"
              aria-pressed={sound.effects}
              onClick={() => {
                primeCentreAudio();
                sound.cycle();
              }}
            >
              {sound.effects ? "sound on" : "sound off"}
            </button>
          </div>
          <CentreReportButton phase={phase} />
        </main>
      </div>
    </>
  );
}
