import { useEffect, useRef, useState } from "react";

/**
 * The line between a symbol and its twin.
 *
 * One component for both places it appears: the moment you land a match in play, and every edge of the
 * constellation afterwards. They are the same drawing — a stroke traced between two points — and
 * building it twice would guarantee they drifted apart.
 *
 * Endpoints are found from the DOM rather than passed in, because the two cards are separate elements
 * whose positions depend on layout the parent does not know. `data-twin-card` and `data-twin-symbol`
 * are the anchors; measurement happens once when the ray appears.
 */
interface TwinRayProps {
  /** The element both cards live inside. Coordinates are measured relative to it. */
  containerRef: React.RefObject<HTMLElement | null>;
  from: { slot: string; symbolId: string };
  to: { slot: string; symbolId: string };
  /** Bumping this re-measures — a new heat, or a new step in the review. */
  token: string;
  durationMs?: number;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

function centreOf(container: HTMLElement, slot: string, symbolId: string) {
  const element = container.querySelector<HTMLElement>(
    `[data-twin-card="${slot}"] [data-twin-symbol="${symbolId}"]`,
  );
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  return {
    x: bounds.left - origin.left + bounds.width / 2,
    y: bounds.top - origin.top + bounds.height / 2,
    size: Math.max(bounds.width, bounds.height),
  };
}

export function TwinRay({ containerRef, from, to, token, durationMs = 520 }: TwinRayProps) {
  const [line, setLine] = useState<Line | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const start = centreOf(container, from.slot, from.symbolId);
      const end = centreOf(container, to.slot, to.symbolId);
      const origin = container.getBoundingClientRect();
      if (!start || !end) {
        setLine(null);
        return;
      }
      setLine({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        width: origin.width,
        height: origin.height,
      });
    };

    // One frame's grace so the cards have laid out before anything is measured.
    frame.current = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, from.slot, from.symbolId, to.slot, to.symbolId, token]);

  if (!line) return null;
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

  return (
    <svg
      className="twin-ray"
      viewBox={`0 0 ${line.width} ${line.height}`}
      width={line.width}
      height={line.height}
      aria-hidden="true"
      focusable="false"
    >
      <line
        key={token}
        className="twin-ray-line"
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        style={{
          strokeDasharray: length,
          strokeDashoffset: length,
          animationDuration: `${durationMs}ms`,
        }}
      />
      <circle className="twin-ray-end" cx={line.x1} cy={line.y1} r={4} />
      <circle
        className="twin-ray-end twin-ray-end--far"
        cx={line.x2}
        cy={line.y2}
        r={4}
        style={{ animationDelay: `${durationMs * 0.7}ms` }}
      />
    </svg>
  );
}
