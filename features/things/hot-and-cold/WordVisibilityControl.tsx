import { useEffect, useState } from "react";

const SHARE_HINT_SEEN_KEY = "hot-and-cold:share-hint-seen";

export function useHotAndColdWordVisibility(resetKey: string) {
  const [visibility, setVisibility] = useState({ resetKey, wordsHidden: false });
  const wordsHidden = visibility.resetKey === resetKey && visibility.wordsHidden;

  const toggleWords = () => {
    setVisibility((current) => ({
      resetKey,
      wordsHidden: current.resetKey === resetKey ? !current.wordsHidden : true,
    }));
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
  const [shareHintVisible, setShareHintVisible] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SHARE_HINT_SEEN_KEY) === "true") return;
      sessionStorage.setItem(SHARE_HINT_SEEN_KEY, "true");
    } catch {
      /* The one-time hint can still appear without storage. */
    }
    setShareHintVisible(true);
    const timer = window.setTimeout(() => setShareHintVisible(false), 4_200);
    return () => window.clearTimeout(timer);
  }, []);

  const label = wordsHidden ? "show all words" : "hide all words for sharing";
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className={`inline-flex min-h-11 min-w-11 items-center justify-center transition-[color,opacity] hover:opacity-60 ${
          wordsHidden ? "text-[var(--things-amber)]" : "theme-muted"
        }`}
        aria-label={label}
        aria-pressed={wordsHidden}
        title={label}
        onClick={() => {
          setShareHintVisible(false);
          onToggle();
        }}
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
      {shareHintVisible ? (
        <span
          role="status"
          className="heat-share-visibility-hint pointer-events-none absolute right-0 top-full z-20 w-max max-w-44 text-right font-mono text-micro leading-relaxed text-[var(--things-amber)]"
        >
          tap the eye to hide words for sharing
        </span>
      ) : null}
    </span>
  );
}
