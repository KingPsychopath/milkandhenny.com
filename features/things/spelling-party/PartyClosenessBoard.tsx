import type { PartyRevealAnswer } from "./types";

function ordinal(place: number) {
  const remainder = place % 100;
  if (remainder >= 11 && remainder <= 13) return `${place}th`;
  if (place % 10 === 1) return `${place}st`;
  if (place % 10 === 2) return `${place}nd`;
  if (place % 10 === 3) return `${place}rd`;
  return `${place}th`;
}

function closenessLabel(answer: PartyRevealAnswer) {
  if (!answer.answer) return "no answer";
  if (answer.correct) return "correct";
  return answer.distance === 1 ? "1 letter away" : `${answer.distance} letters away`;
}

export function PartyClosenessBoard({ answers, currentPlayerId }: { answers: PartyRevealAnswer[]; currentPlayerId?: string }) {
  return (
    <ol className="mt-7 space-y-3" aria-label="Spellings ranked by closeness">
      {answers.map((answer) => {
        const label = closenessLabel(answer);
        const width = answer.answer ? Math.max(4, answer.similarity) : 0;
        return (
          <li key={answer.playerId} aria-label={`${ordinal(answer.place)} place, ${answer.name}, ${label}, spelled ${answer.answer || "nothing"}`} className={`rounded-2xl border p-4 text-left ${answer.playerId === currentPlayerId ? "border-amber-200/45 bg-amber-200/[0.07]" : "border-white/12 bg-white/[0.03]"}`}>
            <div className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-3">
              <span className="font-mono text-xs text-white/40">{ordinal(answer.place)}</span>
              <span className="min-w-0 truncate font-serif text-lg">{answer.name}{answer.playerId === currentPlayerId ? " · you" : ""}</span>
              <span className={`font-mono text-micro ${answer.correct ? "text-amber-200" : "text-white/45"}`}>{label}</span>
            </div>
            <div className="mt-2 grid grid-cols-[2.5rem_1fr] items-center gap-3">
              <span aria-hidden="true" />
              <div>
                <p className="truncate font-mono text-sm tracking-[0.08em] text-white/75">{answer.answer || "—"}</p>
                <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full origin-left rounded-full transition-[width] duration-500 motion-reduce:transition-none ${answer.correct ? "bg-[var(--things-amber)]" : "bg-white/45"}`} style={{ width: `${width}%` }} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
