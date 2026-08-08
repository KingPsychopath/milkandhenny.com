import { twinSymbol } from "./twin-symbols";

/**
 * One symbol, in a 100×100 box, inheriting its colour from the card.
 *
 * Stroke width is in viewBox units on purpose, so a symbol dealt small gets a proportionally lighter
 * line. A constant visual weight reads as a diagram; this reads as a drawing.
 */
export function TwinSymbol({ id, className }: { id: string; className?: string }) {
  const shape = twinSymbol(id);
  if (!shape) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      {shape.paths.map((path, index) => (
        <path
          key={`stroke-${index}`}
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {shape.fills?.map((path, index) => (
        <path key={`fill-${index}`} d={path} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
