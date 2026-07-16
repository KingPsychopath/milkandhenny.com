import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { pairingCode, pairingUrl, type IcebreakerPlayer } from "./icebreaker-pairing";

interface IcebreakerPairingCodeProps {
  player: IcebreakerPlayer;
  returningToResult: boolean;
  onScan: () => void;
  onBack: () => void;
}

export function IcebreakerPairingCode({
  player,
  returningToResult,
  onScan,
  onBack,
}: IcebreakerPairingCodeProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setQrFailed(false);
    const url = pairingUrl(window.location.origin, player);
    void QRCode.toDataURL(url, { width: 320, margin: 1 })
      .then((value) => {
        if (active) setQrCode(value);
      })
      .catch(() => {
        if (active) {
          setQrCode(null);
          setQrFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [player]);

  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="my-code-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">your turn</p>
      <h1 id="my-code-title" className="mt-2 font-serif text-4xl font-semibold">
        Show them this.
      </h1>
      <p className="mt-3 font-serif text-lg leading-relaxed text-white/70">
        {returningToResult
          ? "They scan this to add the same result to their colour book."
          : "They can scan it here or with their phone's Camera app."}
      </p>
      <div className="mx-auto mt-7 aspect-square w-full max-w-72 rounded-3xl bg-white p-4 shadow-2xl">
        {qrCode ? (
          <img src={qrCode} alt="Your Icebreaker pairing QR code" className="h-full w-full" />
        ) : (
          <div className="grid h-full place-items-center font-mono text-xs text-black/55">
            {qrFailed ? "QR unavailable — use the short code" : "making code…"}
          </div>
        )}
      </div>
      <p className="mt-4 font-mono text-xs text-white/55">short code</p>
      <p className="mt-1 font-mono text-xl tracking-[0.18em]">{pairingCode(player)}</p>
      <button
        type="button"
        onClick={returningToResult ? onBack : onScan}
        className="mt-7 min-h-12 w-full rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--things-night)]"
      >
        {returningToResult ? "back to our result" : "now scan their code"}
      </button>
      {!returningToResult ? (
        <button
          type="button"
          onClick={onBack}
          className="mt-2 min-h-11 font-mono text-xs text-white/65 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
        >
          back to my colour
        </button>
      ) : null}
    </section>
  );
}
