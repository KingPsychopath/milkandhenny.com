import { useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  createPairingResult,
  pairingCode,
  pairingPayload,
  parsePairingCode,
  type IcebreakerPlayer,
  type PairingResult,
} from "./icebreaker-pairing";

interface IcebreakerPairingProps {
  player: IcebreakerPlayer;
  onClose: () => void;
}

interface QrScannerProps {
  playerId: string;
  onCancel: () => void;
  onScan: (partner: IcebreakerPlayer) => void;
}

function ManualCodeEntry({ playerId, onScan }: Pick<QrScannerProps, "playerId" | "onScan">) {
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const partner = parsePairingCode(code);
    if (!partner) {
      setError("That code doesn't look right. Try the six characters shown on their screen.");
      return;
    }
    if (partner.id === playerId) {
      setError("That's your own code. Enter the code from the other phone.");
      return;
    }
    onScan(partner);
  };

  return (
    <details className="mt-5 border-t border-white/15 pt-4 text-left">
      <summary className="min-h-11 cursor-pointer content-center font-mono text-xs opacity-70">
        camera not working?
      </summary>
      <form onSubmit={handleSubmit} className="mt-3">
        <label htmlFor={inputId} className="font-mono text-xs opacity-70">
          enter their code
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id={inputId}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setError(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="R-ABCDE"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-full border border-white/20 bg-black/15 px-4 font-mono text-base uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-white/75"
          />
          <button
            type="submit"
            className="min-h-12 rounded-full bg-white px-5 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            pair
          </button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-2 font-mono text-xs text-white/75">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function QrScanner({ playerId, onCancel, onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [message, setMessage] = useState("asking for camera access…");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let animationFrame = 0;

    const stop = () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const start = async () => {
      const Detector = window.BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setMessage("QR scanning isn't available in this browser. Use their short code below.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active || !videoRef.current) return stop();
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setMessage("Point the camera at their QR code.");
        const detector = new Detector({ formats: ["qr_code"] });

        const scanFrame = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const partner = codes[0] ? parsePairingCode(codes[0].rawValue) : null;
            if (partner) {
              if (partner.id === playerId) {
                setMessage("That's your own code. Scan the code on the other phone.");
              } else {
                stop();
                onScanRef.current(partner);
                return;
              }
            }
          } catch {
            // Some browsers throw while the video is warming up; keep scanning.
          }
          animationFrame = requestAnimationFrame(() => void scanFrame());
        };
        animationFrame = requestAnimationFrame(() => void scanFrame());
      } catch {
        setMessage("Camera access wasn't available. You can enter their short code below.");
      }
    };

    void start();
    return stop;
  }, [playerId]);

  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="scanner-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">pair phones</p>
      <h1 id="scanner-title" className="mt-2 font-serif text-4xl font-semibold">
        Scan their code.
      </h1>
      <div className="relative mt-7 aspect-square overflow-hidden rounded-3xl border border-white/20 bg-black/25">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/75"
        />
      </div>
      <p
        aria-live="polite"
        className="mt-4 min-h-10 font-mono text-xs leading-relaxed text-white/70"
      >
        {message}
      </p>
      <ManualCodeEntry playerId={playerId} onScan={onScan} />
      <button
        type="button"
        onClick={onCancel}
        className="mt-3 min-h-11 font-mono text-xs text-white/65 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
      >
        cancel
      </button>
    </section>
  );
}

function MyCode({ player, onScan, onClose }: IcebreakerPairingProps & { onScan: () => void }) {
  const [qrCode, setQrCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(pairingPayload(player), { width: 320, margin: 1 }).then((value) => {
      if (active) setQrCode(value);
    });
    return () => {
      active = false;
    };
  }, [player]);

  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="my-code-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">pair phones</p>
      <h1 id="my-code-title" className="mt-2 font-serif text-4xl font-semibold">
        Show them this.
      </h1>
      <p className="mt-3 font-serif text-lg text-white/70">Once they scan it, swap roles.</p>
      <div className="mx-auto mt-7 aspect-square w-full max-w-72 rounded-3xl bg-white p-4 shadow-2xl">
        {qrCode ? (
          <img src={qrCode} alt="Your Icebreaker pairing QR code" className="h-full w-full" />
        ) : (
          <div className="grid h-full place-items-center font-mono text-xs text-black/55">
            making code…
          </div>
        )}
      </div>
      <p className="mt-4 font-mono text-xs text-white/55">short code</p>
      <p className="mt-1 font-mono text-xl tracking-[0.18em]">{pairingCode(player)}</p>
      <button
        type="button"
        onClick={onScan}
        className="mt-7 min-h-12 w-full rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      >
        scan their code
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 min-h-11 font-mono text-xs text-white/65 hover:text-white focus-visible:ring-2 focus-visible:ring-white/75"
      >
        back to my colour
      </button>
    </section>
  );
}

function PairingResultView({
  player,
  result,
  onShowCode,
  onPairAgain,
  onClose,
}: IcebreakerPairingProps & {
  result: PairingResult;
  onShowCode: () => void;
  onPairAgain: () => void;
}) {
  const partner = result.partner;
  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="pair-result-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/65">
        {result.kind === "match" ? "it's a match" : "you made a mix"}
      </p>
      <div
        className="mx-auto mt-5 h-28 w-28 rounded-full border border-white/35 shadow-2xl"
        style={{
          background:
            result.kind === "match"
              ? player.colour.background
              : `linear-gradient(135deg, ${player.colour.background}, ${partner.colour.background})`,
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
      <div className="mt-7 rounded-3xl bg-black/20 p-6 text-left backdrop-blur-sm">
        <h2 className="font-mono text-micro uppercase tracking-[0.18em] text-white/60">
          ask each other
        </h2>
        <p className="mt-3 font-serif text-xl leading-snug">“{result.question}”</p>
      </div>
      <p className="mt-5 font-serif text-sm text-white/70">
        Let them scan your code too so both phones remember the moment.
      </p>
      <button
        type="button"
        onClick={onShowCode}
        className="mt-4 min-h-12 w-full rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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

export function IcebreakerPairing({ player, onClose }: IcebreakerPairingProps) {
  const [view, setView] = useState<"choose" | "scan" | "show">("choose");
  const [result, setResult] = useState<PairingResult | null>(null);

  const handleScan = (partner: IcebreakerPlayer) => {
    setResult(createPairingResult(player, partner));
  };

  if (result) {
    return (
      <PairingResultView
        player={player}
        result={result}
        onShowCode={() => {
          setResult(null);
          setView("show");
        }}
        onPairAgain={() => {
          setResult(null);
          setView("choose");
        }}
        onClose={onClose}
      />
    );
  }

  if (view === "scan") {
    return (
      <QrScanner playerId={player.id} onScan={handleScan} onCancel={() => setView("choose")} />
    );
  }

  if (view === "show") {
    return <MyCode player={player} onScan={() => setView("scan")} onClose={onClose} />;
  }

  return (
    <section className="w-full max-w-sm text-center text-white" aria-labelledby="pair-title">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/55">
        optional extra
      </p>
      <h1 id="pair-title" className="mt-2 font-serif text-5xl font-semibold">
        Pair phones.
      </h1>
      <p className="mt-4 font-serif text-lg leading-relaxed text-white/70">
        One person shows their code. The other scans it. Then swap.
      </p>
      <div className="mt-8 grid gap-3">
        <button
          type="button"
          onClick={() => setView("scan")}
          className="min-h-14 rounded-full bg-white px-6 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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
        Same colour makes a match. Different colours make something new.
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
