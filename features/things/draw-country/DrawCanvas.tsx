import { useRef } from "react";
import type { CountryDrawing, DrawPoint } from "./types";

const WIDTH = 1_000;
const HEIGHT = 700;
const MIN_POINT_DISTANCE = 7;
const MAX_POINTS = 850;

function pathFor(ring: DrawPoint[]) {
  if (!ring.length) return "";
  return `${ring.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ")}${ring.length > 2 ? " Z" : ""}`;
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

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): DrawPoint | null => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(WIDTH, ((event.clientX - bounds.left) / bounds.width) * WIDTH)),
      y: Math.max(0, Math.min(HEIGHT, ((event.clientY - bounds.top) / bounds.height) * HEIGHT)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || drawing.flat().length >= MAX_POINTS) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    onChange([...drawing, [point]]);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || pointerRef.current !== event.pointerId) return;
    const point = pointFromEvent(event);
    const ring = drawing.at(-1);
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
    if (drawing.at(-1)?.length === 1) onChange(drawing.slice(0, -1));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Drawing area. Drag to draw the country outline; lift and drag again for another island."
      className="block aspect-[10/7] w-full touch-none cursor-crosshair rounded-[1.75rem] border border-black/20 bg-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <title>Country drawing area</title>
      <defs>
        <pattern id="draw-country-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="currentColor" strokeWidth="0.7" />
        </pattern>
      </defs>
      <rect
        width={WIDTH}
        height={HEIGHT}
        fill="url(#draw-country-grid)"
        className="text-black/[0.035]"
      />
      {drawing.map((ring, index) => (
        <path
          key={index}
          d={pathFor(ring)}
          fill={ring.length > 2 ? "currentColor" : "none"}
          fillOpacity="0.035"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
