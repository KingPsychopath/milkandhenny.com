import { useEffect, useId, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { isIosSafari, isStandaloneWebApp } from "./web-app.client";

export function HomeScreenGamePrompt({ tone }: { tone: "dark" | "light" | "theme" }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    setAvailable(isIosSafari() && !isStandaloneWebApp());
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!available) return null;

  const quietText =
    tone === "theme" ? "theme-muted" : tone === "light" ? "text-black/55" : "text-white/55";
  const border =
    tone === "theme" ? "theme-border" : tone === "light" ? "border-black/10" : "border-white/10";

  return (
    <>
      <div className={`mt-5 border-t pt-4 text-center ${border}`}>
        <p className={`font-mono text-micro leading-relaxed ${quietText}`}>
          Want more room in landscape?
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`mt-1 min-h-11 px-4 font-mono text-xs font-semibold underline underline-offset-4 transition-opacity hover:opacity-70 ${quietText}`}
        >
          hide Safari’s bars
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-3 sm:items-center sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] bg-[var(--things-cream)] p-6 text-left text-black shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <p className="pt-3 font-mono text-micro uppercase tracking-[0.18em] text-black/45">
                one-time setup
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-black/15 font-mono text-lg text-black/55"
                aria-label="Close Home Screen instructions"
              >
                ×
              </button>
            </div>
            <h2 id={titleId} className="mt-3 font-serif text-4xl font-semibold leading-tight">
              Use the whole screen.
            </h2>
            <p className="mt-4 font-serif text-lg leading-relaxed text-black/65">
              Add the game to your Home Screen. Open it there to play without Safari’s tabs.
            </p>

            <ol className="mt-6 space-y-4 font-mono text-sm leading-relaxed">
              <li className="flex gap-3">
                <StepNumber>1</StepNumber>
                <span>
                  Tap <strong>Share</strong> in Safari.
                </span>
              </li>
              <li className="flex gap-3">
                <StepNumber>2</StepNumber>
                <span>
                  Tap <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <StepNumber>3</StepNumber>
                <span>
                  Keep <strong>Open as Web App</strong> on if you see it, then tap{" "}
                  <strong>Add</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <StepNumber>4</StepNumber>
                <span>Open the new icon to play.</span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-7 min-h-14 w-full rounded-full bg-black px-6 font-mono text-sm font-semibold text-white"
            >
              got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function StepNumber({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-black/15 text-xs font-bold"
    >
      {children}
    </span>
  );
}
