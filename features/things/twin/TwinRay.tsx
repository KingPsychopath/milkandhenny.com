import { useId, useLayoutEffect, useRef, useState } from "react";

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
  label?: string;
}

interface Connection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  path: string;
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

export function TwinRay({ containerRef, from, to, token, durationMs = 520, label }: TwinRayProps) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const frame = useRef<number | null>(null);
  const gradientId = `twin-ray-${useId().replaceAll(":", "")}`;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const start = centreOf(container, from.slot, from.symbolId);
      const end = centreOf(container, to.slot, to.symbolId);
      const origin = container.getBoundingClientRect();
      if (!start || !end) {
        setConnection(null);
        return;
      }

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) {
        setConnection(null);
        return;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      const startInset = Math.min(start.size * 0.46 + 2, distance * 0.24);
      const endInset = Math.min(end.size * 0.46 + 2, distance * 0.24);
      const x1 = start.x + ux * startInset;
      const y1 = start.y + uy * startInset;
      const x2 = end.x - ux * endInset;
      const y2 = end.y - uy * endInset;
      setConnection({
        x1,
        y1,
        x2,
        y2,
        path: `M ${x1} ${y1} L ${x2} ${y2}`,
        width: origin.width,
        height: origin.height,
      });
    };

    // One frame's grace so the cards have laid out before anything is measured.
    frame.current = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [containerRef, from.slot, from.symbolId, to.slot, to.symbolId, token]);

  if (!connection) return null;

  return (
    <svg
      className="twin-ray"
      viewBox={`0 0 ${connection.width} ${connection.height}`}
      width={connection.width}
      height={connection.height}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={connection.x1}
          y1={connection.y1}
          x2={connection.x2}
          y2={connection.y2}
        >
          <stop offset="0" stopColor="var(--twin-accent)" stopOpacity="0.62" />
          <stop offset="0.48" stopColor="var(--twin-ink)" />
          <stop offset="1" stopColor="var(--twin-accent)" />
        </linearGradient>
      </defs>
      <path
        key={`${token}-glow`}
        className="twin-ray-glow"
        d={connection.path}
        pathLength={1}
        style={{ animationDuration: `${durationMs}ms` }}
      />
      <path
        key={token}
        className="twin-ray-line"
        d={connection.path}
        pathLength={1}
        stroke={`url(#${gradientId})`}
        style={{ animationDuration: `${durationMs}ms` }}
      />
      <circle className="twin-ray-end" cx={connection.x1} cy={connection.y1} r={3.5} />
      <circle
        className="twin-ray-end twin-ray-end--far"
        cx={connection.x2}
        cy={connection.y2}
        r={3.5}
        style={{ animationDelay: `${durationMs * 0.66}ms` }}
      />
      {label ? (
        <g
          className="twin-ray-label"
          transform={`translate(${(connection.x1 + connection.x2) / 2} ${(connection.y1 + connection.y2) / 2})`}
        >
          <rect x="-27" y="-11" width="54" height="22" rx="11" />
          <text textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
