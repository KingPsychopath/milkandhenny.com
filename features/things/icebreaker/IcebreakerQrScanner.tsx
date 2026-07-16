import { useEffect, useId, useRef, useState } from "react";
import { parsePairingCode, type IcebreakerPlayer } from "./icebreaker-pairing";

interface IcebreakerQrScannerProps {
  playerId: string;
  onCancel: () => void;
  onScan: (partner: IcebreakerPlayer) => void;
}

function ManualCodeEntry({
  playerId,
  onScan,
}: Pick<IcebreakerQrScannerProps, "playerId" | "onScan">) {
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const partner = parsePairingCode(code);
    if (!partner) {
      setError("That code doesn't look right. Enter the six characters shown on their screen.");
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
      <summary className="min-h-11 cursor-pointer content-center font-mono text-xs opacity-70 focus-visible:ring-2 focus-visible:ring-white/75">
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
            inputMode="text"
            maxLength={12}
            placeholder="R-ABCDE"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-full border border-white/20 bg-black/15 px-4 font-mono text-base uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-white/75"
          />
          <button
            type="submit"
            className="min-h-12 rounded-full bg-white px-5 font-mono text-sm font-semibold text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--things-night)]"
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

export function IcebreakerQrScanner({ playerId, onCancel, onScan }: IcebreakerQrScannerProps) {
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
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      const Detector = window.BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setMessage("Use your phone's Camera app, or enter their short code below.");
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
        if (!active) return stop();
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
            // Detection may fail while the video warms up; the next frame retries.
          }
          animationFrame = requestAnimationFrame(() => void scanFrame());
        };
        animationFrame = requestAnimationFrame(() => void scanFrame());
      } catch {
        setMessage("Camera access wasn't available. Use your Camera app or their short code.");
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
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview for scanning a pairing code"
          className="h-full w-full object-cover"
        />
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
