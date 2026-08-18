import { threeWordMapUrl } from "../types";

/**
 * The "find the exact door" hint.
 *
 * The field is free text, so this is only a link when the hint is actually a
 * what3words address. When it is, it carries the same ↗ the map link uses:
 * three dotted words do not read as a destination, and someone tapping it at
 * a dark front door should know the page is about to be replaced by another
 * site rather than wonder where their ticket went.
 */
export function ThreeWordHint({ hint, className = "" }: { hint: string; className?: string }) {
  const url = threeWordMapUrl(hint);

  if (!url) {
    return <span className={`block font-mono text-xs theme-muted mt-1 ${className}`}>{hint}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`block font-mono text-xs theme-muted mt-1 underline hover:opacity-70 transition-opacity ${className}`}
    >
      {hint}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens what3words in a new tab)</span>
    </a>
  );
}
