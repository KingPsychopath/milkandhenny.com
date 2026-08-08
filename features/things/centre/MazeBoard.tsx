import { useEffect, useMemo, useRef, useState } from "react";
import {
  CENTRE_CELL,
  centreCellId,
  centreCellParts,
  centreEntrancePoint,
  centreMazeCellAt,
  centreViewRotation,
  rotateCentrePoint,
} from "./centre-generator";
import { moveCentreTrace } from "./centre-trace";
import type { CentreMaze, CentrePoint, CentreRoute } from "./types";

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The maze wrapper is a custom pointer and keyboard application. */

export interface MazeRouteLayer {
  id: string;
  colour: number;
  route: CentreRoute;
  untilMs?: number;
  muted?: boolean;
}

function svgNumber(value: number) {
  return value.toFixed(6);
}

function arc(radius: number, start: number, end: number) {
  const from = { x: Math.cos(start) * radius, y: Math.sin(start) * radius };
  const to = { x: Math.cos(end) * radius, y: Math.sin(end) * radius };
  return `M ${svgNumber(from.x)} ${svgNumber(from.y)} A ${svgNumber(radius)} ${svgNumber(radius)} 0 0 1 ${svgNumber(to.x)} ${svgNumber(to.y)}`;
}

function wallPaths(maze: CentreMaze) {
  const paths: string[] = [];
  const sectorAngle = (Math.PI * 2) / maze.sectors;
  const ringWidth = (1 - maze.centreRadius) / maze.rings;
  for (let ring = 0; ring < maze.rings; ring += 1)
    for (let sector = 0; sector < maze.sectors; sector += 1) {
      const id = centreCellId(ring, sector);
      const start = sector * sectorAngle;
      const end = (sector + 1) * sectorAngle;
      const inner = maze.centreRadius + ring * ringWidth;
      const outer = inner + ringWidth;
      const inward = ring === 0 ? CENTRE_CELL : centreCellId(ring - 1, sector);
      if (!maze.links[id].includes(inward)) paths.push(arc(inner, start, end));
      const clockwise = centreCellId(ring, (sector + 1) % maze.sectors);
      if (!maze.links[id].includes(clockwise)) {
        const x1 = Math.cos(end) * inner;
        const y1 = Math.sin(end) * inner;
        const x2 = Math.cos(end) * outer;
        const y2 = Math.sin(end) * outer;
        paths.push(`M ${svgNumber(x1)} ${svgNumber(y1)} L ${svgNumber(x2)} ${svgNumber(y2)}`);
      }
    }
  const entrances = new Set(maze.entranceSectors);
  for (let sector = 0; sector < maze.sectors; sector += 1) {
    const start = sector * sectorAngle;
    const end = (sector + 1) * sectorAngle;
    if (!entrances.has(sector)) paths.push(arc(1, start, end));
    else {
      const gap = sectorAngle * 0.32;
      const middle = start + sectorAngle / 2;
      paths.push(arc(1, start, middle - gap));
      paths.push(arc(1, middle + gap, end));
    }
  }
  return paths;
}

function routePoints(route: CentreRoute, untilMs = Number.POSITIVE_INFINITY) {
  return route.segments.map((segment) =>
    segment
      .filter(({ t }) => t <= untilMs)
      .map(({ x, y }) => `${svgNumber(x)},${svgNumber(y)}`)
      .join(" "),
  );
}

function cellCentre(maze: CentreMaze, id: string, time: number): CentrePoint {
  if (id === CENTRE_CELL) return { x: 0, y: 0, t: time };
  const cell = centreCellParts(id)!;
  const width = (1 - maze.centreRadius) / maze.rings;
  const radius = maze.centreRadius + (cell.ring + 0.5) * width;
  const angle = ((cell.sector + 0.5) / maze.sectors) * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, t: time };
}

export function MazeBoard({
  maze,
  entranceIndex,
  phase,
  startsAt,
  route,
  routeLayers = [],
  playerColour = 0,
  onRouteChange,
  onArmChange,
  onCollision,
  onFinish,
  cancelCountdownOnRelease = false,
  rivalPoints = [],
}: {
  maze: CentreMaze;
  entranceIndex: number;
  phase: "arming" | "countdown" | "racing" | "finishing" | "finished" | "replay";
  startsAt: number | null;
  route: CentreRoute;
  routeLayers?: MazeRouteLayer[];
  playerColour?: number;
  onRouteChange?: (route: CentreRoute) => void;
  onArmChange?: (armed: boolean) => void;
  onCollision?: () => void;
  onFinish?: (route: CentreRoute) => void;
  cancelCountdownOnRelease?: boolean;
  rivalPoints?: Array<{ id: string; x: number; y: number; colour: number }>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const collisionRef = useRef(false);
  const finishRef = useRef(false);
  const routeRef = useRef(route);
  const [now, setNow] = useState(Date.now());
  const walls = useMemo(() => wallPaths(maze), [maze]);
  const rotation = centreViewRotation(maze, entranceIndex);
  const entrance = useMemo(() => centreEntrancePoint(maze, entranceIndex), [entranceIndex, maze]);
  const visibleEntrance = rotateCentrePoint(entrance, rotation);
  routeRef.current = route;

  useEffect(() => {
    if (phase !== "countdown" && phase !== "racing" && phase !== "finishing") return;
    let frame = 0;
    const tick = () => {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "racing" || !heldRef.current || routeRef.current.segments.length > 0) return;
    onRouteChange?.({ segments: [[entrance]], wallHits: 0 });
  }, [entrance, onRouteChange, phase]);

  const eventPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const local = {
      x: ((event.clientX - bounds.left) / bounds.width) * 2.16 - 1.08,
      y: ((event.clientY - bounds.top) / bounds.height) * 2.16 - 1.08,
    };
    return rotateCentrePoint(local, -rotation);
  };

  const begin = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0 || pointerRef.current !== null) return;
    const point = eventPoint(event);
    if (!point) return;
    const active = routeRef.current.segments.at(-1)?.at(-1) ?? entrance;
    const target = phase === "arming" ? entrance : active;
    if (Math.hypot(point.x - target.x, point.y - target.y) > (phase === "arming" ? 0.13 : 0.1))
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.parentElement?.focus();
    pointerRef.current = event.pointerId;
    heldRef.current = true;
    if (phase === "arming") onArmChange?.(true);
  };

  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      pointerRef.current !== event.pointerId ||
      (phase !== "racing" && phase !== "finishing") ||
      !startsAt ||
      finishRef.current
    )
      return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    let nextRoute = routeRef.current;
    for (const sample of events) {
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) continue;
      const local = {
        x: ((sample.clientX - bounds.left) / bounds.width) * 2.16 - 1.08,
        y: ((sample.clientY - bounds.top) / bounds.height) * 2.16 - 1.08,
      };
      const canonical = rotateCentrePoint(local, -rotation);
      const previous = nextRoute.segments.at(-1)?.at(-1);
      if (!previous) continue;
      const target: CentrePoint = { ...canonical, t: Math.max(0, Date.now() - startsAt) };
      const result = moveCentreTrace(maze, previous, target);
      if (Math.hypot(result.point.x - previous.x, result.point.y - previous.y) > 0.003) {
        const segments = nextRoute.segments.slice();
        segments[segments.length - 1] = [...segments.at(-1)!, result.point];
        nextRoute = { ...nextRoute, segments };
      }
      if (result.collided && !collisionRef.current) {
        collisionRef.current = true;
        nextRoute = { ...nextRoute, wallHits: nextRoute.wallHits + 1 };
        onCollision?.();
      } else if (!result.collided) collisionRef.current = false;
      if (result.finished) {
        finishRef.current = true;
        onRouteChange?.(nextRoute);
        onFinish?.(nextRoute);
        return;
      }
    }
    routeRef.current = nextRoute;
    onRouteChange?.(nextRoute);
  };

  const end = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    heldRef.current = false;
    collisionRef.current = false;
    if (phase === "arming" || (phase === "countdown" && cancelCountdownOnRelease))
      onArmChange?.(false);
  };

  const keyboardMove = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (phase === "arming" && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      heldRef.current = true;
      onArmChange?.(true);
      return;
    }
    if ((phase !== "racing" && phase !== "finishing") || !startsAt || finishRef.current) return;
    const previous = routeRef.current.segments.at(-1)?.at(-1) ?? entrance;
    const current = centreMazeCellAt(maze, previous);
    if (!current) return;
    const parts = centreCellParts(current);
    let wanted: string | null = null;
    if (parts && event.key === "ArrowLeft")
      wanted = centreCellId(parts.ring, (parts.sector + maze.sectors - 1) % maze.sectors);
    else if (parts && event.key === "ArrowRight")
      wanted = centreCellId(parts.ring, (parts.sector + 1) % maze.sectors);
    else if (parts && event.key === "ArrowUp")
      wanted = parts.ring === 0 ? CENTRE_CELL : centreCellId(parts.ring - 1, parts.sector);
    else if (parts && event.key === "ArrowDown" && parts.ring < maze.rings - 1)
      wanted = centreCellId(parts.ring + 1, parts.sector);
    if (!wanted) return;
    event.preventDefault();
    if (!maze.links[current].includes(wanted)) {
      onCollision?.();
      onRouteChange?.({ ...routeRef.current, wallHits: routeRef.current.wallHits + 1 });
      return;
    }
    const point = cellCentre(maze, wanted, Date.now() - startsAt);
    const segments = routeRef.current.segments.length
      ? routeRef.current.segments.slice()
      : [[entrance]];
    segments[segments.length - 1] = [...segments.at(-1)!, point];
    const next = { ...routeRef.current, segments };
    routeRef.current = next;
    onRouteChange?.(next);
    if (wanted === CENTRE_CELL) {
      finishRef.current = true;
      onFinish?.(next);
    }
  };

  const remaining = startsAt ? Math.max(0, startsAt - now) : null;
  const count = remaining && remaining > 0 ? Math.min(3, Math.ceil(remaining / 1_000)) : null;
  const hidden = phase === "arming" || phase === "countdown";

  return (
    <div
      className="centre-board-wrap"
      tabIndex={0}
      role="application"
      aria-label="Circular maze. Press and hold the marked entrance. During the race, trace towards the centre. Keyboard players use the arrow keys."
      onKeyDown={keyboardMove}
    >
      <svg
        ref={svgRef}
        viewBox="-1.08 -1.08 2.16 2.16"
        className="centre-board"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <title>Circular maze</title>
        <g
          transform={`rotate(${svgNumber((rotation * 180) / Math.PI)})`}
          className={hidden ? "centre-maze-hidden" : ""}
        >
          <circle r={maze.centreRadius * 0.72} className="centre-goal" />
          <g className="centre-walls">
            {walls.map((path, index) => (
              <path d={path} key={index} />
            ))}
          </g>
          {routeLayers.map((layer) =>
            routePoints(layer.route, layer.untilMs).map((points, segment) =>
              points ? (
                <polyline
                  key={`${layer.id}:${segment}`}
                  points={points}
                  className={`centre-route centre-colour-${layer.colour}${layer.muted ? " centre-route--muted" : ""}`}
                />
              ) : null,
            ),
          )}
          {rivalPoints.map((point) => (
            <circle
              key={point.id}
              cx={svgNumber(point.x)}
              cy={svgNumber(point.y)}
              r="0.035"
              className={`centre-rival-dot centre-colour-${point.colour}`}
            />
          ))}
          {routePoints(route).map((points, segment) =>
            points ? (
              <polyline
                key={segment}
                points={points}
                className={`centre-route centre-route--active centre-colour-${playerColour}`}
              />
            ) : null,
          )}
        </g>
        <circle
          cx={svgNumber(visibleEntrance.x)}
          cy={svgNumber(visibleEntrance.y)}
          r="0.08"
          className={`centre-start centre-colour-${playerColour}`}
        />
        {hidden ? (
          <g className="centre-countdown" data-count={count ?? undefined} aria-hidden="true">
            <circle r="0.98" className="centre-countdown-mask" />
            <circle
              cx={svgNumber(visibleEntrance.x)}
              cy={svgNumber(visibleEntrance.y)}
              r="0.14"
              className="centre-start-ring centre-start-ring--one"
            />
            <circle
              cx={svgNumber(visibleEntrance.x)}
              cy={svgNumber(visibleEntrance.y)}
              r="0.2"
              className="centre-start-ring centre-start-ring--two"
            />
            <circle
              cx={svgNumber(visibleEntrance.x)}
              cy={svgNumber(visibleEntrance.y)}
              r="0.26"
              className="centre-start-ring centre-start-ring--three"
            />
          </g>
        ) : null}
      </svg>
      {hidden ? (
        <div className="centre-start-copy" aria-live="assertive">
          <strong>{phase === "arming" ? "press and hold" : count}</strong>
          <span>{phase === "arming" ? "on the start circle" : "keep holding"}</span>
        </div>
      ) : phase === "racing" && startsAt && now - startsAt < 850 ? (
        <div className="centre-go-copy" aria-hidden="true">
          GO
        </div>
      ) : null}
    </div>
  );
}
