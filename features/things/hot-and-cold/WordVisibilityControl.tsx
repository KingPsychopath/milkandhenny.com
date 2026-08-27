import { useEffect, useState } from "react";

const STORAGE_KEY = "hot-and-cold:words-hidden";

export function useHotAndColdWordVisibility() {
  const [wordsHidden, setWordsHidden] = useState(false);

  useEffect(() => {
    try {
      setWordsHidden(sessionStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      /* Screenshot mode can remain available without persistence. */
    }
  }, []);

  const toggleWords = () => {
    setWordsHidden((hidden) => {
      const next = !hidden;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* Screenshot mode can remain available without persistence. */
      }
      return next;
    });
  };

  return { wordsHidden, toggleWords };
}

export function WordVisibilityControl({
  wordsHidden,
  onToggle,
}: {
  wordsHidden: boolean;
  onToggle: () => void;
}) {
  const label = wordsHidden ? "show words" : "hide words";
  return (
    <button
      type="button"
      className="inline-flex min-h-11 min-w-11 items-center justify-center transition-opacity hover:opacity-60"
      aria-label={label}
      aria-pressed={wordsHidden}
      title={label}
      onClick={onToggle}
    >
      <svg
        className="h-4 w-4 fill-none stroke-current"
        viewBox="0 0 24 24"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
        {wordsHidden ? <path d="m4 4 16 16" /> : null}
      </svg>
    </button>
  );
}
