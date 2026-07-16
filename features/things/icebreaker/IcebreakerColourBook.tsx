import {
  COLOURS,
  encounterResult,
  type IcebreakerLedger,
  type IcebreakerPlayer,
} from "./icebreaker-pairing";

interface IcebreakerColourBookProps {
  ledger: IcebreakerLedger;
  player: IcebreakerPlayer;
  onClose: () => void;
}

export function IcebreakerColourBook({ ledger, player, onClose }: IcebreakerColourBookProps) {
  return (
    <section className="w-full max-w-sm text-white" aria-labelledby="colour-book-title">
      <div className="text-center">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">
          kept on this device
        </p>
        <h1 id="colour-book-title" className="mt-2 font-serif text-5xl font-semibold">
          My colours.
        </h1>
        <p className="mt-3 font-serif text-base leading-relaxed text-white/65">
          Your original colour stays the same. Matches and mixes collect here.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-4 border-y border-white/15 py-5">
        <div
          className="h-14 w-14 flex-none rounded-full border border-white/30"
          style={{ background: player.colour.background }}
          aria-hidden="true"
        />
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.16em] text-white/45">
            original colour
          </p>
          <p className="mt-1 font-serif text-2xl font-semibold">{player.colour.name}</p>
        </div>
      </div>

      {ledger.encounters.length ? (
        <ul className="divide-y divide-white/10" aria-label="Collected matches and mixes">
          {ledger.encounters.map((encounter) => {
            const result = encounterResult(encounter);
            const partnerColour = COLOURS.find(
              (colour) => colour.code === encounter.partnerColourCode,
            );
            if (!result || !partnerColour) return null;
            return (
              <li key={encounter.id} className="flex items-center gap-4 py-5">
                <div
                  className="h-12 w-12 flex-none rounded-full border border-white/25"
                  style={{
                    background:
                      result.kind === "match"
                        ? player.colour.background
                        : `linear-gradient(135deg, ${player.colour.background}, ${partnerColour.background})`,
                  }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-xl font-semibold">{result.name}</p>
                  <p className="mt-1 font-mono text-xs text-white/50">
                    {result.kind === "match"
                      ? `${player.colour.name} + ${partnerColour.name}`
                      : `${player.colour.name} × ${partnerColour.name}`}
                  </p>
                </div>
                <span className="font-mono text-micro uppercase text-white/40">{result.kind}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-10 text-center font-serif text-lg leading-relaxed text-white/55">
          Your first confirmed match or mix will appear here.
        </p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-5 min-h-12 w-full rounded-full border border-white/20 px-6 font-mono text-sm font-semibold focus-visible:ring-2 focus-visible:ring-white/75"
      >
        back to my colour
      </button>
    </section>
  );
}
