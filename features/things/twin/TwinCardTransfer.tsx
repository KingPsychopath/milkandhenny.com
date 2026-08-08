import { useLayoutEffect, useRef, useState } from "react";

interface Transfer {
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
}

export function TwinCardTransfer({
  containerRef,
  from,
  to,
  token,
  durationMs,
  reverse = false,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  from: string;
  to: string;
  token: string;
  durationMs: number;
  reverse?: boolean;
}) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    frame.current = window.requestAnimationFrame(() => {
      const source = container.querySelector<HTMLElement>(`[data-twin-card="${from}"]`);
      const target = container.querySelector<HTMLElement>(`[data-twin-card="${to}"]`);
      if (!source || !target) return;
      const origin = container.getBoundingClientRect();
      const start = source.getBoundingClientRect();
      const end = target.getBoundingClientRect();
      setTransfer({
        x: start.left - origin.left,
        y: start.top - origin.top,
        dx: end.left + end.width / 2 - (start.left + start.width / 2),
        dy: end.top + end.height / 2 - (start.top + start.height / 2),
        size: start.width,
      });
    });
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [containerRef, from, to, token]);

  if (!transfer) return null;
  return (
    <div
      className={`twin-card-transfer ${reverse ? "twin-card-transfer--reverse" : ""}`}
      style={
        {
          left: transfer.x,
          top: transfer.y,
          width: transfer.size,
          height: transfer.size,
          "--twin-transfer-x": `${transfer.dx}px`,
          "--twin-transfer-y": `${transfer.dy}px`,
          animationDuration: `${durationMs}ms`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    />
  );
}
