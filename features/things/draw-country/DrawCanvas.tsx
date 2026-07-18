import { useRef, useState } from "react";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_RINGS,
  MAX_POINTS_PER_RING,
} from "./drawing-constraints";
import type { CountryDrawing, DrawPoint } from "./types";

const MIN_POINT_DISTANCE = 7;

function pathFor(ring: DrawPoint[], closed: boolean) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ")}${closed && ring.length > 2 ? " Z" : ""}`;
}

export function DrawCanvas({
  drawing,
  disabled = false,
  onChange,
}: {
  drawing: CountryDrawing;
  disabled?: boolean;
  onChange: (drawing: CountryDrawing) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [activeRing, setActiveRing] = useState<number | null>(null);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): DrawPoint | null => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(
        0,
        Math.min(DRAWING_WIDTH, ((event.clientX - bounds.left) / bounds.width) * DRAWING_WIDTH),
      ),
      y: Math.max(
        0,
        Math.min(DRAWING_HEIGHT, ((event.clientY - bounds.top) / bounds.height) * DRAWING_HEIGHT),
      ),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointCount = drawing.reduce((total, ring) => total + ring.length, 0);
    if (
      disabled ||
      pointerRef.current !== null ||
      !event.isPrimary ||
      event.button !== 0 ||
      drawing.length >= MAX_DRAWING_RINGS ||
      pointCount >= MAX_DRAWING_POINTS
    )
      return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    setActiveRing(drawing.length);
    onChange([...drawing, [point]]);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || pointerRef.current !== event.pointerId) return;
    const pointCount = drawing.reduce((total, ring) => total + ring.length, 0);
    const ring = drawing.at(-1);
    if (!ring || pointCount >= MAX_DRAWING_POINTS || ring.length >= MAX_POINTS_PER_RING) return;
    const point = pointFromEvent(event);
    const previous = ring?.at(-1);
    if (
      !ring ||
      !point ||
      !previous ||
      Math.hypot(point.x - previous.x, point.y - previous.y) < MIN_POINT_DISTANCE
    )
      return;
    onChange([...drawing.slice(0, -1), [...ring, point]]);
  };

  const handlePointerEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setActiveRing(null);
    if (drawing.at(-1)?.length === 1) onChange(drawing.slice(0, -1));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${DRAWING_WIDTH} ${DRAWING_HEIGHT}`}
      role="img"
      aria-label="Drawing area. Drag to draw the country outline. A faint guide returns to your starting point and becomes the closing edge when you lift. Drag again for another island."
      aria-describedby="draw-country-instructions"
      className="block aspect-[4/3] w-full touch-none cursor-crosshair select-none rounded-[1.75rem] border border-black/20 bg-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      <title>Country drawing area</title>
      <defs>
        <pattern id="draw-country-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="currentColor" strokeWidth="0.7" />
        </pattern>
      </defs>
      <rect
        width={DRAWING_WIDTH}
        height={DRAWING_HEIGHT}
        fill="url(#draw-country-grid)"
        className="text-black/[0.035]"
      />
      {drawing.map((ring, index) => {
        const active = index === activeRing;
        const first = ring[0];
        const last = ring.at(-1);
        return (
          <g key={index}>
            <path
              d={pathFor(ring, !active)}
              fill={!active && ring.length > 2 ? "currentColor" : "none"}
              fillOpacity="0.035"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {active && first && last && ring.length > 1 ? (
              <line
                x1={last.x}
                y1={last.y}
                x2={first.x}
                y2={first.y}
                className="stroke-black/20"
                strokeWidth="2"
                strokeDasharray="7 8"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {active && first ? (
              <circle
                cx={first.x}
                cy={first.y}
                r="7"
                className="fill-[var(--things-cream)] stroke-black/40"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
