import { useEffect, useMemo, useRef, useState } from "react";
import { TwinCard } from "./TwinCard";
import { TwinRay } from "./TwinRay";
import { TwinSymbol } from "./TwinSymbol";
import { twinSymbolName } from "./twin-symbols";
import { twinRandom } from "./twin-deck";
import type { TwinLoggedConnection, TwinLoggedHeat } from "./types";

/**
 * The game, drawn.
 *
 * The middle card was replaced by a card sharing exactly one symbol with it, which was replaced the
 * same way, and so on — so the sequence of middle cards is a path where **every edge is a single
 * symbol**. That is a constellation with a name for each line, and it is not a metaphor: it is the
 * literal structure of what happened.
 *
 * The spine is that path. The ribs are the cards other people shed against the same middle card. A
 * player's longest chain is a run of consecutive spine positions where they have a rib, which is why
 * lighting it up looks like tracing a constellation rather than reading a table.
 */

const NODE_GAP = 92;
const WANDER = 46;

interface SpineNode {
  heat: TwinLoggedHeat;
  x: number;
  y: number;
  /** The connection that led out of this node, if the heat was won. */
  exit: TwinLoggedConnection | null;
  ribs: TwinLoggedConnection[];
}

function buildSpine(heats: readonly TwinLoggedHeat[]): SpineNode[] {
  // Seeded so the wander is stable across re-renders and across everyone looking at the same game.
  const random = twinRandom(heats.length * 7919 + 13);
  return heats.map((heat, index) => ({
    heat,
    x: 50 + (random() - 0.5) * 2 * WANDER,
    y: 40 + index * NODE_GAP,
    exit: heat.connections.find(({ won }) => won) ?? null,
    ribs: heat.connections.filter(({ won }) => !won),
  }));
}

/** The longest run of consecutive heats this player landed. */
function longestRun(heats: readonly TwinLoggedHeat[], playerId: string) {
  let best: number[] = [];
  let current: number[] = [];
  heats.forEach((heat, index) => {
    if (heat.connections.some((connection) => connection.playerId === playerId)) {
      current.push(index);
      if (current.length > best.length) best = [...current];
    } else current = [];
  });
  return new Set(best);
}

export function TwinConstellation({
  heats,
  players,
}: {
  heats: TwinLoggedHeat[];
  players: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const spine = useMemo(() => buildSpine(heats), [heats]);
  const run = useMemo(
    () => (filter ? longestRun(heats, filter) : new Set<number>()),
    [filter, heats],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setSelected((current) => {
        if (current >= spine.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1_400);
    return () => window.clearInterval(timer);
  }, [playing, spine.length]);

  if (heats.length === 0)
    return <p className="twin-note">No heats were played, so there is nothing to draw.</p>;

  const node = spine[Math.min(selected, spine.length - 1)];
  const shown = filter
    ? (node.heat.connections.find(({ playerId }) => playerId === filter) ?? null)
    : node.exit;
  const height = 40 + spine.length * NODE_GAP + 40;

  return (
    <section className="twin-constellation" aria-label="Every connection in the game">
      <div className="twin-constellation-controls">
        <div className="twin-filters" role="group" aria-label="Show one player's connections">
          <button
            type="button"
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
            className="twin-filter"
          >
            the whole game
          </button>
          {players.map((player) => (
            <button
              key={player.id}
              type="button"
              aria-pressed={filter === player.id}
              onClick={() => setFilter(filter === player.id ? null : player.id)}
              className="twin-filter"
            >
              {player.name}
            </button>
          ))}
        </div>
        <div className="twin-stepper">
          <button
            type="button"
            className="twin-step"
            onClick={() => setSelected((current) => Math.max(0, current - 1))}
            disabled={selected === 0}
            aria-label="Previous heat"
          >
            ←
          </button>
          <button type="button" className="twin-step" onClick={() => setPlaying(!playing)}>
            {playing ? "pause" : "play"}
          </button>
          <button
            type="button"
            className="twin-step"
            onClick={() => setSelected((current) => Math.min(spine.length - 1, current + 1))}
            disabled={selected >= spine.length - 1}
            aria-label="Next heat"
          >
            →
          </button>
        </div>
      </div>

      <div className="twin-constellation-body">
        <div className="twin-chart-scroll">
          <svg
            className="twin-chart"
            viewBox={`0 0 100 ${height}`}
            width="100%"
            height={height}
            preserveAspectRatio="xMidYMin meet"
            role="img"
            aria-label={`${heats.length} heats, joined by the symbol that won each one`}
          >
            <polyline
              className="twin-chart-spine"
              points={spine.map(({ x, y }) => `${x},${y}`).join(" ")}
            />
            {spine.map((entry, index) => {
              const next = spine[index + 1];
              const lit = filter === null ? index === selected : run.has(index);
              return (
                <g key={entry.heat.number}>
                  {next && entry.exit ? (
                    <line
                      className={`twin-chart-edge ${lit ? "twin-chart-edge--lit" : ""}`}
                      x1={entry.x}
                      y1={entry.y}
                      x2={next.x}
                      y2={next.y}
                    />
                  ) : null}
                  {entry.ribs.map((rib, ribIndex) => {
                    const side = ribIndex % 2 === 0 ? -1 : 1;
                    const reach = 16 + Math.floor(ribIndex / 2) * 11;
                    const dim = filter !== null && rib.playerId !== filter;
                    return (
                      <line
                        key={`${rib.playerId}-${rib.card.cardId}`}
                        className={`twin-chart-rib ${dim ? "twin-chart-rib--dim" : ""}`}
                        x1={entry.x}
                        y1={entry.y}
                        x2={entry.x + side * reach}
                        y2={entry.y + 20}
                      />
                    );
                  })}
                  {entry.ribs.map((rib, ribIndex) => {
                    const side = ribIndex % 2 === 0 ? -1 : 1;
                    const reach = 16 + Math.floor(ribIndex / 2) * 11;
                    const dim = filter !== null && rib.playerId !== filter;
                    return (
                      <circle
                        key={`dot-${rib.playerId}-${rib.card.cardId}`}
                        className={`twin-chart-rib-dot ${dim ? "twin-chart-rib--dim" : ""}`}
                        cx={entry.x + side * reach}
                        cy={entry.y + 20}
                        r={2.4}
                      />
                    );
                  })}
                  <circle
                    className={`twin-chart-node ${index === selected ? "twin-chart-node--on" : ""} ${
                      entry.heat.burned ? "twin-chart-node--burned" : ""
                    }`}
                    cx={entry.x}
                    cy={entry.y}
                    r={index === selected ? 7 : 5}
                    style={{ animationDelay: `${index * 40}ms` }}
                  />
                  <circle
                    className="twin-chart-hit"
                    cx={entry.x}
                    cy={entry.y}
                    r={16}
                    onClick={() => {
                      setPlaying(false);
                      setSelected(index);
                    }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="twin-detail" ref={detailRef}>
          <p className="twin-eyebrow twin-eyebrow--tight">
            heat {node.heat.number} of {heats.length}
          </p>
          {shown ? (
            <>
              <p className="twin-detail-line">
                <span className="twin-detail-symbol">
                  <TwinSymbol id={shown.symbolId} />
                </span>
                <span>
                  <strong>{shown.name}</strong> found the {twinSymbolName(shown.symbolId)} in{" "}
                  {(shown.elapsedMs / 1_000).toFixed(2)}s
                </span>
              </p>
              <div className="twin-detail-cards">
                <TwinCard
                  card={shown.card}
                  slot="review-shed"
                  label={`${shown.name}'s card`}
                  focusSymbolId={shown.symbolId}
                />
                <TwinCard
                  card={node.heat.middle}
                  slot="review-middle"
                  label="The card in the middle"
                  focusSymbolId={shown.symbolId}
                />
                <TwinRay
                  containerRef={detailRef}
                  from={{ slot: "review-shed", symbolId: shown.symbolId }}
                  to={{ slot: "review-middle", symbolId: shown.symbolId }}
                  token={`${node.heat.number}-${shown.playerId}-${shown.symbolId}`}
                  durationMs={620}
                />
              </div>
            </>
          ) : (
            <>
              <p className="twin-detail-line">
                {node.heat.burned
                  ? "Nobody found this one. Every hand turned over."
                  : filter
                    ? "They missed this heat."
                    : "No connection was made."}
              </p>
              <div className="twin-detail-cards">
                <TwinCard
                  card={node.heat.middle}
                  slot="review-middle"
                  label="The card in the middle"
                />
              </div>
            </>
          )}
          {node.heat.connections.length > 1 ? (
            <p className="twin-detail-others">
              also shed by{" "}
              {node.heat.connections
                .filter(({ playerId }) => playerId !== shown?.playerId)
                .map(({ name }) => name)
                .join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
