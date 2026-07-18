import { TextMorph } from "torph/react";
import { DrawCanvas } from "./DrawCanvas";
import { drawingIsValid } from "./scoring";
import type { CountryDrawing } from "./types";

export function CountryRoundBoard({
  countryName,
  drawing,
  seconds,
  roundLabel,
  submitting = false,
  submitted = false,
  onChange,
  onDone,
}: {
  countryName: string;
  drawing: CountryDrawing;
  seconds: number;
  roundLabel?: string;
  submitting?: boolean;
  submitted?: boolean;
  onChange: (drawing: CountryDrawing) => void;
  onDone: () => void;
}) {
  const valid = drawingIsValid(drawing);
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[min(56rem,max(20rem,calc((100svh-13rem)*10/7)))] flex-1 flex-col px-4 pb-6 sm:px-6"
    >
      <div className="flex min-h-16 items-end justify-between gap-4 pb-3 font-mono text-xs uppercase tracking-[0.14em] text-black/55">
        <div>
          {roundLabel ? <span className="mr-3 text-black/35">{roundLabel}</span> : null}
          <span className="mr-2 text-black/35">draw</span>
          <span className="sr-only">{countryName}</span>
          <span aria-hidden="true">
            <TextMorph as="span" className="font-semibold text-black">
              {countryName}
            </TextMorph>
          </span>
        </div>
        <span className="sr-only">{seconds} seconds remaining</span>
        <span aria-hidden="true">
          <TextMorph as="span" className="text-base font-semibold text-black">
            {`${seconds}s`}
          </TextMorph>
        </span>
      </div>
      <DrawCanvas drawing={drawing} disabled={submitting || submitted} onChange={onChange} />
      <p
        id="draw-country-instructions"
        className="mt-3 px-1 font-mono text-micro leading-relaxed text-black/45"
      >
        draw anywhere — we align position and size · keep clear of the edge · lift to close; draw
        again for islands
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!drawing.length || submitting || submitted}
            onClick={() => onChange(drawing.slice(0, -1))}
            className="min-h-11 rounded-full border border-black/15 px-5 font-mono text-xs disabled:opacity-35"
          >
            undo stroke
          </button>
          <button
            type="button"
            disabled={!drawing.length || submitting || submitted}
            onClick={() => onChange([])}
            className="min-h-11 rounded-full px-4 font-mono text-xs text-black/55 disabled:opacity-35"
          >
            clear
          </button>
        </div>
        <button
          type="button"
          disabled={!valid || submitting || submitted}
          onClick={onDone}
          className="min-h-12 rounded-full bg-black px-7 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-30"
        >
          {submitted ? "locked in" : submitting ? "scoring…" : "done"}
        </button>
      </div>
    </main>
  );
}
