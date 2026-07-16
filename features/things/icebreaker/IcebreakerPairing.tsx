import { useCallback, useEffect, useRef, useState } from "react";
import { IcebreakerPairingCode } from "./IcebreakerPairingCode";
import { IcebreakerQrScanner } from "./IcebreakerQrScanner";
import {
  encounterResult,
  type EncounterOutcome,
  type IcebreakerPlayer,
  type PairingResult,
} from "./icebreaker-pairing";

interface IcebreakerPairingProps {
  player: IcebreakerPlayer;
  initialPartner?: IcebreakerPlayer | null;
  initialError?: string | null;
  onClose: () => void;
  onEncounter: (partner: IcebreakerPlayer) => EncounterOutcome;
}

interface PairingDisplay {
  persisted: boolean;
  result: PairingResult;
  status: "new" | "repeat";
}

function PairingResultView({
  player,
  display,
  onShowCode,
  onPairAgain,
  onClose,
}: Pick<IcebreakerPairingProps, "player" | "onClose"> & {
  display: PairingDisplay;
  onShowCode: () => void;
  onPairAgain: () => void;
}) {
  const { result, status } = display;
  const partner = result.partner;
  const colours = [player.colour, partner.colour].sort((first, second) =>
    first.code.localeCompare(second.code),
  );
  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="pair-result-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/65">
        {status === "repeat"
          ? "already in your colour book"
          : result.kind === "match"
            ? "it's a match"
            : "you made a mix"}
      </p>
      <div
        className="mx-auto mt-5 h-28 w-28 rounded-full border border-white/35 shadow-2xl"
        style={{
          background:
            result.kind === "match"
              ? player.colour.background
              : `linear-gradient(135deg, ${colours[0]?.background}, ${colours[1]?.background})`,
        }}
        aria-hidden="true"
      />
      <h1 id="pair-result-title" className="mt-5 font-serif text-5xl font-semibold leading-none">
        {result.name}
      </h1>
      <p className="mt-3 font-mono text-xs text-white/65">
        {result.kind === "match"
          ? `${player.colour.name} + ${partner.colour.name}`
          : `${player.colour.name} × ${partner.colour.name}`}
      </p>
      <p className="mt-4 font-mono text-xs text-white/55">
        {!display.persisted
          ? "saved for this visit · device storage is unavailable"
          : status === "new"
            ? "✓ saved on this device"
            : "✓ no duplicate added"}
      </p>
      <div className="mt-6 rounded-3xl bg-white/[0.08] p-6 text-left">
        <h2 className="font-mono text-micro uppercase tracking-[0.18em] text-white/60">
          ask each other
        </h2>
        <p className="mt-3 font-serif text-xl leading-snug">“{result.question}”</p>
      </div>
      <p className="mt-5 font-serif text-sm leading-relaxed text-white/70">
        Show them your code so they can save this result too.
      </p>
      <button
        type="button"
        onClick={onShowCode}
        className="mt-4 min-h-12 w-full rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--things-night)]"
      >
        show my code
      </button>
      <div className="mt-2 flex justify-center gap-5">
        <button
          type="button"
          onClick={onPairAgain}
          className="min-h-11 font-mono text-xs text-white/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
        >
          pair again
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 font-mono text-xs text-white/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
        >
          back to my colour
        </button>
      </div>
    </section>
  );
}

export function IcebreakerPairing({
  player,
  initialPartner = null,
  initialError = null,
  onClose,
  onEncounter,
}: IcebreakerPairingProps) {
  const [view, setView] = useState<"choose" | "scan" | "show">("choose");
  const [display, setDisplay] = useState<PairingDisplay | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const consumedInitialPartner = useRef(false);

  const handlePartner = useCallback(
    (partner: IcebreakerPlayer) => {
      const outcome = onEncounter(partner);
      if (outcome.status === "self" || !outcome.encounter) {
        setError("That's your own code. Scan the code on the other phone.");
        setView("choose");
        return;
      }
      const result = encounterResult(outcome.encounter);
      if (!result) {
        setError("That pairing couldn't be read. Ask them to show their code again.");
        setView("choose");
        return;
      }
      setError(null);
      setDisplay({ persisted: outcome.persisted !== false, result, status: outcome.status });
    },
    [onEncounter],
  );

  useEffect(() => {
    if (!initialPartner || consumedInitialPartner.current) return;
    consumedInitialPartner.current = true;
    handlePartner(initialPartner);
  }, [handlePartner, initialPartner]);

  if (view === "show") {
    return (
      <IcebreakerPairingCode
        player={player}
        returningToResult={Boolean(display)}
        onScan={() => setView("scan")}
        onBack={() => (display ? setView("choose") : onClose())}
      />
    );
  }

  if (display) {
    return (
      <PairingResultView
        player={player}
        display={display}
        onShowCode={() => setView("show")}
        onPairAgain={() => {
          setDisplay(null);
          setView("choose");
        }}
        onClose={onClose}
      />
    );
  }

  if (view === "scan") {
    return (
      <IcebreakerQrScanner
        playerId={player.id}
        onScan={handlePartner}
        onCancel={() => setView("choose")}
      />
    );
  }

  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="pair-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">
        optional confirmation
      </p>
      <h1 id="pair-title" className="mt-2 font-serif text-5xl font-semibold">
        Pair colours.
      </h1>
      <p className="mt-4 font-serif text-lg leading-relaxed text-white/70">
        One person shows a code. The other scans it. Take turns only if you want the result on both
        phones.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-white/10 p-3 font-mono text-xs text-white/80"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-8 grid gap-3">
        <button
          type="button"
          onClick={() => setView("scan")}
          className="min-h-14 rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--things-night)]"
        >
          scan their code
        </button>
        <button
          type="button"
          onClick={() => setView("show")}
          className="min-h-14 rounded-full border border-white/25 px-6 font-mono text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-white/75"
        >
          show my code
        </button>
      </div>
      <p className="mt-5 font-mono text-xs leading-relaxed text-white/50">
        Same colour confirms a match. Different colours create a collectible mix.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 min-h-11 font-mono text-xs text-white/65 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
      >
        not now
      </button>
    </section>
  );
}
